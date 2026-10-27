import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ForgeAssets } from './assets';
import { foundrySolids, foldDefinitions, foldTransform, type V3 } from './arena';
import { palette } from './config';
import type { ForgeSettings } from './settings';
import type { ForgeState, ForgePlayer } from './contracts';
import { ForgeAnimation } from './animation';
import { ForgeCamera } from './camera';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const presets = {
  competitive: { scale: 1, shadows: 0 },
  low: { scale: 0.6, shadows: 0 },
  medium: { scale: 0.85, shadows: 512 },
  high: { scale: 1, shadows: 1024 },
  ultra: { scale: 1.2, shadows: 2048 },
};
export class ForgeRenderer {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly cameraController = new ForgeCamera();
  readonly camera = this.cameraController.camera;
  readonly assets = new ForgeAssets();
  private environment: T.WebGLRenderTarget | null = null;
  private modules = new Map<string, T.Object3D>();
  private moduleSlots = new Map<string, number>();
  private moduleBatches: T.InstancedMesh[] = [];
  private nodes = new Map<string, T.Object3D>();
  private pilots = new Map<
    string,
    { object: T.Object3D; animation: ForgeAnimation; marker: T.Object3D }
  >();
  private ownedGeometries: T.BufferGeometry[] = [];
  private ownedMaterials: T.Material[] = [];
  private weapon: T.Object3D | null = null;
  private core: T.Mesh | null = null;
  private sun = new T.DirectionalLight('#fff4df', 3);
  private size = { w: 1, h: 1 };
  private currentQuality = '';
  private autoQuality: 'low' | 'competitive' | 'medium' = 'medium';
  private canvas: HTMLCanvasElement;
  private muzzle: T.Mesh | null = null;
  private warning = new Map<string, T.Mesh>();
  private disposed = false;
  constructor(
    private host: HTMLElement,
    public settings: ForgeSettings,
  ) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'THE FOUNDRY — игровая сцена');
    host.appendChild(this.canvas);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene.background = new T.Color('#bacbd7');
    this.scene.fog = new T.Fog('#bacbd7', 50, 120);
    this.scene.add(new T.HemisphereLight('#d9eeff', '#597071', 2));
    this.sun.position.set(-18, 32, 12);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -28;
    this.sun.shadow.camera.right = 28;
    this.sun.shadow.camera.top = 25;
    this.sun.shadow.camera.bottom = -25;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.bias = -0.0002;
    this.scene.add(this.sun);
    const pmrem = new T.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.05);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(this.camera);
    this.updateSettings(settings);
    this.resize();
  }
  private geometry<G extends T.BufferGeometry>(g: G) {
    this.ownedGeometries.push(g);
    return g;
  }
  private material<M extends T.Material>(m: M) {
    this.ownedMaterials.push(m);
    return m;
  }
  async initialize() {
    await this.assets.load();
    if (this.disposed) return;
    const poses: T.Object3D[] = [];
    for (const d of foundrySolids) {
      if (d.id === 'floor') {
        const floor = new T.Mesh(
          this.geometry(new T.BoxGeometry(d.size.x, d.size.y, d.size.z)),
          this.material(
            new T.MeshStandardMaterial({ color: '#687b85', roughness: 0.83, metalness: 0.05 }),
          ),
        );
        floor.position.copy(d.p);
        floor.receiveShadow = true;
        this.scene.add(floor);
        continue;
      }
      const object = new T.Object3D();
      object.position.copy(d.p);
      object.scale.set(d.size.x, d.size.y, d.size.z);
      object.rotation.set(d.pitch ?? 0, d.yaw ?? 0, 0);
      object.updateMatrix();
      poses.push(object);
    }
    for (const d of foldDefinitions) {
      const object = new T.Object3D();
      object.scale.copy(d.size);
      object.position.copy(d.a);
      object.rotation.y = d.yawA;
      object.updateMatrix();
      this.moduleSlots.set(d.id, poses.length);
      poses.push(object);
      this.modules.set(d.id, object);
      const instance = this.assets.instance('fold-node').object;
      instance.position.set(d.node.x, 0, d.node.z);
      instance.rotation.y = d.node.z > 0 ? 0 : Math.PI;
      this.scene.add(instance);
      this.nodes.set(d.id, instance);
      const ring = new T.Mesh(
        this.geometry(new T.RingGeometry(0.5, 0.65, 40)),
        this.material(
          new T.MeshBasicMaterial({
            color: palette.yellow,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: T.DoubleSide,
          }),
        ),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.node.x, 0.025, d.node.z);
      this.scene.add(ring);
      const width = Math.abs(d.a.x - d.b.x) + Math.hypot(d.size.x, d.size.z),
        depth =
          Math.abs(d.a.z - d.b.z) + (d.yawA !== d.yawB ? Math.hypot(d.size.x, d.size.z) : d.size.z);
      const warn = new T.Mesh(
        this.geometry(new T.PlaneGeometry(width, depth)),
        this.material(
          new T.MeshBasicMaterial({
            color: palette.yellow,
            opacity: 0.13,
            transparent: true,
            depthWrite: false,
          }),
        ),
      );
      warn.rotation.x = -Math.PI / 2;
      warn.position.set((d.a.x + d.b.x) / 2, 0.035, (d.a.z + d.b.z) / 2);
      warn.visible = false;
      this.scene.add(warn);
      this.warning.set(d.id, warn);
    }
    // Each material of the authored module is drawn once for the entire arena.
    // Moving panels update three instance matrices, not hundreds of objects.
    const prefab = this.assets.instance('forge-module').object;
    prefab.updateMatrixWorld(true);
    const parts = new Map<T.Material, T.BufferGeometry[]>();
    prefab.traverse((object) => {
      if (object instanceof T.Mesh) {
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
        const list = parts.get(material) ?? [];
        list.push(geometry);
        parts.set(material, list);
      }
    });
    for (const [material, geometries] of parts) {
      const geometry = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      if (!geometry) throw Error('Forge module merge failed');
      this.ownedGeometries.push(geometry);
      const batch = new T.InstancedMesh(geometry, material, poses.length);
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      batch.castShadow = true;
      batch.receiveShadow = true;
      for (const [i, pose] of poses.entries()) batch.setMatrixAt(i, pose.matrix);
      batch.computeBoundingSphere();
      this.moduleBatches.push(batch);
      this.scene.add(batch);
    }
    // Fixed authored architectural rhythm. Decorative elements never become
    // invisible competitive cover and are shared by all quality presets.
    const beamG = this.geometry(new T.BoxGeometry(0.22, 0.22, 35)),
      beamM = this.material(
        new T.MeshStandardMaterial({ color: palette.graphite, roughness: 0.5 }),
      );
    for (const x of [-20, -14, 14, 20]) {
      const beam = new T.Mesh(beamG, beamM);
      beam.position.set(x, 6, 0);
      this.scene.add(beam);
    }
    const lineG = this.geometry(new T.BoxGeometry(0.08, 0.015, 30)),
      lineM = this.material(new T.MeshBasicMaterial({ color: palette.yellow }));
    for (const x of [-19, 19]) {
      const m = new T.Mesh(lineG, lineM);
      m.position.set(x, 0.012, 0);
      this.scene.add(m);
    }
    const core = new T.Mesh(
      this.geometry(new T.IcosahedronGeometry(0.65, 1)),
      this.material(
        new T.MeshStandardMaterial({
          color: palette.cyan,
          emissive: palette.cyan,
          emissiveIntensity: 0.4,
          metalness: 0.2,
          roughness: 0.3,
        }),
      ),
    );
    core.position.set(0, 1.15, 0);
    this.core = core;
    this.scene.add(core);
    for (const slot of [0, 1]) {
      const circle = new T.Mesh(
        this.geometry(new T.RingGeometry(1.4, 1.48, 40)),
        this.material(
          new T.MeshBasicMaterial({
            color: slot ? palette.coral : palette.cyan,
            side: T.DoubleSide,
          }),
        ),
      );
      circle.rotation.x = -Math.PI / 2;
      circle.position.set(0, 0.02, slot ? -13 : 13);
      this.scene.add(circle);
    }
    this.weapon = this.assets.instance('vector-r9').object;
    this.weapon.position.set(0.32, -0.3, -0.6);
    this.camera.add(this.weapon);
    this.weapon.visible = false;
    this.muzzle = new T.Mesh(
      this.geometry(new T.OctahedronGeometry(0.045)),
      this.material(new T.MeshBasicMaterial({ color: palette.yellow })),
    );
    this.muzzle.position.set(0.32, -0.28, -1.45);
    this.muzzle.visible = false;
    this.camera.add(this.muzzle);
    const warmup = new T.Group();
    warmup.add(
      this.assets.instance('pilot-cyan').object,
      this.assets.instance('pilot-coral').object,
    );
    this.scene.add(warmup);
    this.weapon.visible = true;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.weapon.visible = false;
    this.scene.remove(warmup);
  }
  get element() {
    return this.canvas;
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.size = { w: Math.max(1, width), h: Math.max(1, height) };
    this.camera.aspect = this.size.w / this.size.h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.size.w, this.size.h);
  }
  updateSettings(s: ForgeSettings, autoQuality?: 'low' | 'competitive' | 'medium') {
    this.settings = s;
    if (autoQuality) this.autoQuality = autoQuality;
    const key = s.quality === 'auto' ? this.autoQuality : s.quality;
    if (key === this.currentQuality) return;
    this.currentQuality = key;
    const p = presets[key];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * p.scale);
    this.renderer.shadowMap.enabled = p.shadows > 0;
    this.sun.shadow.mapSize.setScalar(p.shadows || 256);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.resize();
  }
  private pilot(p: ForgePlayer) {
    let actor = this.pilots.get(p.id);
    if (!actor) {
      const { object, clips } = this.assets.instance(p.slot ? 'pilot-coral' : 'pilot-cyan');
      const marker = new T.Mesh(
        this.geometry(new T.TorusGeometry(0.23, 0.022, 6, p.slot ? 3 : 20)),
        this.material(new T.MeshBasicMaterial({ color: p.slot ? palette.coral : palette.cyan })),
      );
      marker.position.y = 2.15;
      object.add(marker);
      this.scene.add(object);
      actor = { object, marker, animation: new ForgeAnimation(object, clips) };
      this.pilots.set(p.id, actor);
    }
    return actor;
  }
  frame(
    state: ForgeState | null,
    localId: string,
    local: V3 | null,
    yaw: number,
    pitch: number,
    dt: number,
    time: number,
    shotAt: number,
    menu: boolean,
    aim = false,
  ) {
    if (this.core) {
      this.core.rotation.y = time * 0.5;
      this.core.position.y = 1.2 + Math.sin(time) * 0.1;
    }
    if (state) {
      for (const n of state.nodes) {
        const d = foldDefinitions.find((d) => d.id === n.id)!,
          t = foldTransform(d, n),
          o = this.modules.get(n.id)!;
        o.position.set(t.x, t.y, t.z);
        o.rotation.y = t.yaw;
        o.updateMatrix();
        for (const batch of this.moduleBatches)
          batch.setMatrixAt(this.moduleSlots.get(n.id)!, o.matrix);
        this.warning.get(n.id)!.visible = n.phase !== 'idle';
      }
      for (const p of state.players) {
        const actor = this.pilot(p);
        actor.object.visible = p.id !== localId && p.hp > 0;
        actor.object.position.set(p.x, p.y - 0.9, p.z);
        actor.object.rotation.y = p.yaw + Math.PI;
        actor.animation.update(p, dt, state.phase);
      }
    } else {
      for (const d of foldDefinitions) {
        const o = this.modules.get(d.id);
        if (o) {
          o.position.copy(d.a);
          o.rotation.y = d.yawA;
          o.updateMatrix();
          for (const batch of this.moduleBatches)
            batch.setMatrixAt(this.moduleSlots.get(d.id)!, o.matrix);
        }
      }
    }
    for (const batch of this.moduleBatches) batch.instanceMatrix.needsUpdate = true;
    this.cameraController.update(
      local,
      yaw,
      pitch,
      menu,
      time,
      dt,
      this.settings.headBob,
      state?.players.find((p) => p.id === localId),
      aim,
    );
    if (this.weapon) {
      this.weapon.visible = !!local && !menu;
      const recoil = Math.max(0, 1 - (time - shotAt) / 0.13);
      this.weapon.position.z = -0.6 + recoil * 0.065;
      const blend = 1 - Math.exp(-14 * dt);
      this.weapon.position.x += ((aim ? 0.025 : 0.32) - this.weapon.position.x) * blend;
      this.weapon.position.y += ((aim ? -0.17 : -0.3) - this.weapon.position.y) * blend;
      this.weapon.rotation.x = recoil * 0.035;
      const p = state?.players.find((p) => p.id === localId);
      this.weapon.rotation.z = p?.reload ? Math.sin(p.reload * 3) * 0.2 : 0;
    }
    if (this.muzzle) this.muzzle.visible = !!local && !menu && time - shotAt < 0.035;
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true;
    for (const p of this.pilots.values()) p.animation.dispose();
    this.pilots.clear();
    for (const batch of this.moduleBatches) batch.dispose();
    this.moduleBatches.length = 0;
    this.assets.dispose();
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.environment?.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
