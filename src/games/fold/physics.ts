import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Euler } from 'three';
import { foundrySolids, foldDefinitions, foldTransform, inFoldSweep, type V3 } from './arena';
import { balance, FOLD_DT } from './config';
import type { FoldNodeState, ForgeCommand, ForgePlayer } from './contracts';
let initialization: Promise<void> | null = null;
export function initializeForgePhysics() {
  return (initialization ??= RAPIER.init());
}
export class ForgePhysics {
  world = new RAPIER.World({ x: 0, y: -balance.gravity, z: 0 });
  private controller = this.world.createCharacterController(0.015);
  private actors = new Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider }>();
  private modules = new Map<string, RAPIER.RigidBody>();
  private actorHandles = new Map<number, string>();
  constructor() {
    this.world.timestep = FOLD_DT;
    this.controller.enableAutostep(0.32, 0.18, false);
    this.controller.enableSnapToGround(0.22);
    this.controller.setSlideEnabled(true);
    for (const def of foundrySolids) {
      const q = new Quaternion().setFromEuler(new Euler(def.pitch ?? 0, def.yaw ?? 0, 0));
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(def.size.x / 2, def.size.y / 2, def.size.z / 2)
          .setTranslation(def.p.x, def.p.y, def.p.z)
          .setRotation(q),
      );
    }
    for (const def of foldDefinitions) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.a.x, def.a.y, def.a.z),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(def.size.x / 2, def.size.y / 2, def.size.z / 2),
        body,
      );
      this.modules.set(def.id, body);
    }
  }
  addPlayer(p: ForgePlayer) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.34), body);
    this.actors.set(p.id, { body, collider });
    this.actorHandles.set(collider.handle, p.id);
  }
  reset(p: ForgePlayer) {
    const actor = this.actors.get(p.id);
    if (actor) {
      actor.body.setTranslation(p, false);
      actor.body.setNextKinematicTranslation(p);
    }
  }
  modulesAt(nodes: FoldNodeState[]) {
    for (const n of nodes) {
      const def = foldDefinitions.find((d) => d.id === n.id)!;
      const t = foldTransform(def, n),
        b = this.modules.get(n.id)!;
      b.setTranslation(t, false);
      b.setNextKinematicTranslation(t);
      b.setRotation({ x: 0, y: Math.sin(t.yaw / 2), z: 0, w: Math.cos(t.yaw / 2) }, false);
    }
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  move(p: ForgePlayer, input: ForgeCommand, nodes: FoldNodeState[]) {
    const actor = this.actors.get(p.id)!;
    const length = Math.max(1, Math.hypot(input.moveX, input.moveZ));
    const speed =
      p.slide > 0 ? balance.slideSpeed : input.sprint && !input.aim ? balance.sprint : balance.walk;
    const sx = input.moveX / length,
      sz = input.moveZ / length;
    const dx = (sx * Math.cos(input.yaw) + sz * Math.sin(input.yaw)) * speed;
    const dz = (-sx * Math.sin(input.yaw) + sz * Math.cos(input.yaw)) * speed;
    const blend =
      1 - Math.exp(-(p.grounded ? balance.acceleration : balance.airAcceleration) * FOLD_DT);
    p.vx += (dx - p.vx) * blend;
    p.vz += (dz - p.vz) * blend;
    if (input.jump && p.grounded && p.slide <= 0) {
      p.vy = balance.jump;
      p.grounded = false;
    }
    p.vy -= balance.gravity * FOLD_DT;
    p.impulseX *= Math.exp(-5 * FOLD_DT);
    p.impulseZ *= Math.exp(-5 * FOLD_DT);
    const desired = {
      x: (p.vx + p.impulseX) * FOLD_DT,
      y: p.vy * FOLD_DT,
      z: (p.vz + p.impulseZ) * FOLD_DT,
    };
    const next = { x: p.x + desired.x, y: p.y + desired.y, z: p.z + desired.z };
    for (const n of nodes)
      if (n.phase === 'moving') {
        const d = foldDefinitions.find((d) => d.id === n.id)!;
        if (!inFoldSweep(d, p) && inFoldSweep(d, next)) {
          desired.x = 0;
          desired.z = 0;
        }
      }
    this.controller.computeColliderMovement(
      actor.collider,
      desired,
      undefined,
      undefined,
      (c) => !this.actorHandles.has(c.handle),
    );
    const movement = this.controller.computedMovement();
    p.x += movement.x;
    p.y += movement.y;
    p.z += movement.z;
    p.grounded = this.controller.computedGrounded();
    if (p.grounded && p.vy < 0) p.vy = 0;
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    actor.body.setNextKinematicTranslation(p);
  }
  step() {
    this.world.step();
  }
  ray(
    origin: V3,
    direction: V3,
    range: number,
    exclude: string,
    historical?: Map<string, V3>,
  ): { id: string | null; distance: number } | null {
    this.world.propagateModifiedBodyPositionsToColliders();
    const ray = new RAPIER.Ray(origin, direction);
    let result: { id: string | null; distance: number } | null = null;
    // Explicit Rapier shape queries do not mutate live actors or depend on
    // broad-phase bounds from another tick. Only actors use historical poses;
    // currently closed Fold geometry always occludes the shot.
    this.world.forEachCollider((c) => {
      const id = this.actorHandles.get(c.handle);
      if (id === exclude) return;
      const position = (id ? historical?.get(id) : undefined) ?? c.translation();
      const distance = c.shape.castRay(
        ray,
        position,
        c.rotation(),
        result?.distance ?? range,
        true,
      );
      if (distance >= 0 && distance <= (result?.distance ?? range))
        result = { id: id ?? null, distance };
    });
    return result;
  }
  restore(players: ForgePlayer[]) {
    for (const p of players) this.actors.get(p.id)?.body.setTranslation(p, false);
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  dispose() {
    this.world.free();
    this.actors.clear();
    this.modules.clear();
  }
}
