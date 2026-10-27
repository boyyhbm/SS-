import { balance, FOLD_DT } from './config';
import { aimDirection } from './arena-system';
import type { ForgeCommand, ForgeEvent, ForgePlayer, ForgeState } from './contracts';
import type { ForgePhysics } from './physics';
import type { V3 } from './arena';
export class ForgeCombat {
  private history: { tick: number; positions: Map<string, V3> }[] = [];
  record(state: ForgeState) {
    this.history.push({
      tick: state.tick,
      positions: new Map(state.players.map((p) => [p.id, { x: p.x, y: p.y, z: p.z }])),
    });
    if (this.history.length > balance.rewindTicks + 2) this.history.shift();
  }
  reset() {
    this.history.length = 0;
  }
  update(
    state: ForgeState,
    inputs: Map<string, ForgeCommand>,
    physics: ForgePhysics,
    event: (type: ForgeEvent['type'], p: ForgePlayer, target?: ForgePlayer) => void,
  ) {
    const now = state.tick * FOLD_DT;
    const damageEvents: { shooter: ForgePlayer; victim: ForgePlayer; damage: number }[] = [];
    for (const p of state.players) {
      if (p.hp <= 0) continue;
      const c = inputs.get(p.id);
      if (!c) continue;
      if (p.reload > 0) {
        p.reload = Math.max(0, p.reload - FOLD_DT);
        if (p.reload === 0) p.ammo = balance.magazine;
      }
      if (c.reload && p.ammo < balance.magazine && p.reload <= 0) {
        p.reload = balance.reloadSeconds;
        event('reload', p);
      }
      if (c.impulse && now >= p.impulseReady) {
        p.impulseReady = now + balance.impulseCooldown;
        event('impulse', p);
        const dir = aimDirection(p.yaw, p.pitch),
          origin = { x: p.x, y: p.y + 0.55, z: p.z };
        const hit = physics.ray(origin, dir, balance.impulseRange, p.id);
        const target = state.players.find((q) => q.id === hit?.id && q.hp > 0);
        if (target) {
          target.impulseX = dir.x * balance.impulseSpeed;
          target.impulseZ = dir.z * balance.impulseSpeed;
          target.vy = Math.max(target.vy, 2);
          target.capture = 0;
        }
      }
      if (!c.fire || p.reload > 0 || p.ammo <= 0 || now < p.shot) continue;
      p.ammo--;
      p.shot = now + balance.fireSeconds;
      event('shot', p);
      // Client supplies only a bounded observation tick, never positions or hit claims.
      const oldest = state.tick - balance.rewindTicks;
      const sample =
        c.aimTick >= oldest && c.aimTick <= state.tick
          ? this.history.findLast((h) => h.tick <= c.aimTick)
          : undefined;
      const origin = { x: p.x, y: p.y + 0.55, z: p.z },
        dir = aimDirection(p.yaw, p.pitch);
      // The live arena is retained even when actor capsules are rewound. A currently
      // closed Fold wall always blocks a compensated shot.
      const hit = physics.ray(origin, dir, balance.range, p.id, sample?.positions);
      const victim = state.players.find((q) => q.id === hit?.id && q.id !== p.id && q.hp > 0);
      if (victim && hit) {
        const historical = sample?.positions.get(victim.id) ?? victim;
        const head = origin.y + dir.y * hit.distance > historical.y + 0.42;
        const falloff = Math.max(
          balance.minimumDamage,
          balance.damage - Math.max(0, hit.distance - balance.falloffStart) * 0.22,
        );
        const damage = Math.round(falloff * (head ? balance.headshot : 1));
        damageEvents.push({ shooter: p, victim, damage });
      }
    }
    // Resolve shots from the same fixed tick together; slot ordering cannot
    // suppress a valid simultaneous shot from the second participant.
    for (const { shooter, victim, damage } of damageEvents) {
      victim.hp = Math.max(0, victim.hp - damage);
      shooter.damage += damage;
      event('hit', shooter, victim);
    }
  }
}
