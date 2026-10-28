import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ForgeAssets } from './assets';
import { foundrySolids } from './arena';
import { palette } from './config';

export type FoundryTextureQuality = 'low' | 'medium' | 'high';
const textureSizes = { low: 256, medium: 512, high: 1024 };
type Placement = { x: number; y: number; z: number; yaw?: number; scale?: number };

// Presentation only. Collision extents and ray queries remain in arena.ts.
// Wall-mounted detail is inset into those extents, while the crown hangs above
// reachable space. Nothing adds invisible cover or a quality-dependent route.
export class FoundryArt {
  readonly root = new T.Group();
  readonly contacts = new T.Group();
  private detail = new T.Group();
  private geometries: T.BufferGeometry[] = [];
  private materials: T.Material[] = [];
  private textures: T.Texture[] = [];
  private floors: T.MeshStandardMaterial[] = [];
  private floorMaps = new Map<FoundryTextureQuality, T.Texture[]>();
  private staticParts = new Map<
    string,
    { material: T.Material; geometries: T.BufferGeometry[]; shadow: boolean }
  >();
  private shadowMaterial: T.MeshBasicMaterial | null = null;
  private disposed = false;
  constructor(private renderer: T.WebGLRenderer) {
    this.root.name = 'Foundry / authored architectural presentation';
    this.root.add(this.contacts);
    this.root.add(this.detail);
  }
  private geometry<G extends T.BufferGeometry>(g: G) {
    this.geometries.push(g);
    return g;
  }
  private material<M extends T.Material>(m: M) {
    this.materials.push(m);
    return m;
  }
  async initialize(assets: ForgeAssets) {
    const loader = new T.TextureLoader();
    await Promise.all(
      (Object.keys(textureSizes) as FoundryTextureQuality[]).map(async (quality) => {
        const maps = await Promise.all(
          ['color', 'normal', 'roughness'].map(async (kind) => {
            const t = await loader.loadAsync(
              `/game-assets/forge/foundry/floor-${kind}-${textureSizes[quality]}.png`,
            );
            t.colorSpace = kind === 'color' ? T.SRGBColorSpace : T.NoColorSpace;
            t.wrapS = t.wrapT = T.RepeatWrapping;
            t.repeat.set(11.5, 9);
            t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            if (this.disposed) {
              t.dispose();
              return t;
            }
            this.textures.push(t);
            this.renderer.initTexture(t);
            return t;
          }),
        );
        this.floorMaps.set(quality, maps);
      }),
    );
    if (this.disposed) return;
    const floor = (color: string, w: number, d: number, x: number, y: number) => {
      const m = this.material(
        new T.MeshStandardMaterial({
          color,
          roughness: 1,
          metalness: 0.06,
          normalScale: new T.Vector2(0.4, 0.4),
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      this.floors.push(m);
      const mesh = new T.Mesh(this.geometry(new T.PlaneGeometry(w, d)), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, 0);
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };
    floor('#85877e', 45, 35, 0, 0.004);
    floor('#4d6472', 8.35, 34, 17.2, 0.009);
    floor('#877c69', 8.35, 34, -17.2, 0.009);
    this.setTextureQuality('high');

    const columns: Placement[] = [];
    for (const x of [-21.79, 21.79])
      for (const z of [-14, -7, 0, 7, 14])
        columns.push({ x, y: 0, z, yaw: x < 0 ? Math.PI / 2 : -Math.PI / 2, scale: 1.1 });
    this.instances(assets, 'service-column', columns);
    this.instances(
      assets,
      'vent-bank',
      [-12, 0, 12].map((z) => ({ x: -21.47, y: 2.4, z, yaw: Math.PI / 2 })),
    );
    this.instances(
      assets,
      'research-inset',
      [-11, 0, 11].map((z) => ({ x: 21.48, y: 2.15, z, yaw: -Math.PI / 2 })),
    );
    // The exchanger and instrument faces sit on existing solid reactor bodies.
    this.instances(assets, 'pipe-bank', [
      { x: -6, y: 1.55, z: -5.34 },
      { x: -16, y: 0.8, z: 6.94, scale: 0.65 },
    ]);
    this.instances(assets, 'research-inset', [
      { x: 6, y: 1.55, z: 8.66 },
      { x: 16, y: 0.8, z: -5.06, scale: 0.65 },
    ]);
    this.instances(assets, 'bulkhead-frame', [
      { x: -18, y: 0.05, z: -16.99 },
      { x: 18, y: 0.05, z: 16.99, yaw: Math.PI },
    ]);
    this.instances(assets, 'core-crown', [{ x: 0, y: 5.7, z: 0 }]);
    for (const part of this.staticParts.values()) {
      const geometry = mergeGeometries(part.geometries, false);
      for (const g of part.geometries) g.dispose();
      if (!geometry) throw Error('Foundry static batching failed');
      const mesh = new T.Mesh(this.geometry(geometry), part.material);
      mesh.castShadow = part.shadow;
      mesh.receiveShadow = true;
      (part.shadow ? this.root : this.detail).add(mesh);
    }
    this.staticParts.clear();

    const lineMaterial = this.material(
      new T.MeshStandardMaterial({ color: '#c8ae65', roughness: 0.9, metalness: 0 }),
    );
    const lineGeometry = this.geometry(new T.PlaneGeometry(0.075, 33));
    for (const x of [-13.05, 13.05, -19, 19]) {
      const line = new T.Mesh(lineGeometry, lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.021, 0);
      line.receiveShadow = true;
      this.root.add(line);
    }
    this.sign('01 / INDUSTRIAL', 'THERMAL SYSTEMS', palette.orange, -21.43, 3.45, -7, Math.PI / 2);
    this.sign('02 / RESEARCH', 'OPTICS DIVISION', palette.cyan, 21.43, 3.45, 7, -Math.PI / 2);
    this.sign('CENTRAL CORE', 'OVERRIDE / 45 SEC', palette.yellow, 0, 3.1, 8.57, 0);
    this.sign('CENTRAL CORE', 'OVERRIDE / 45 SEC', palette.yellow, 0, 3.1, -8.57, Math.PI);

    const alpha = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const at = (y * 64 + x) * 4,
          d = Math.max(Math.abs(x - 31.5), Math.abs(y - 31.5)) / 31.5;
        alpha[at] = alpha[at + 1] = alpha[at + 2] = 0;
        alpha[at + 3] = Math.round(255 * Math.max(0, 1 - d) ** 0.4);
      }
    const shadow = new T.DataTexture(alpha, 64, 64);
    shadow.needsUpdate = true;
    this.textures.push(shadow);
    const shadowMaterial = this.material(
      new T.MeshBasicMaterial({
        map: shadow,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.shadowMaterial = shadowMaterial;
    const contactParts: T.BufferGeometry[] = [];
    for (const solid of foundrySolids) {
      if (solid.id === 'floor' || solid.id.startsWith('roof')) continue;
      const blob = new T.Mesh(
        new T.PlaneGeometry(solid.size.x + 0.7, solid.size.z + 0.7),
        shadowMaterial,
      );
      blob.rotation.set(-Math.PI / 2, 0, solid.yaw ?? 0);
      blob.position.set(solid.p.x, 0.018, solid.p.z);
      blob.updateMatrix();
      contactParts.push(blob.geometry.applyMatrix4(blob.matrix));
    }
    const merged = mergeGeometries(contactParts, false);
    for (const g of contactParts) g.dispose();
    if (merged) this.contacts.add(new T.Mesh(this.geometry(merged), shadowMaterial));
  }
  private instances(assets: ForgeAssets, part: string, placements: Placement[]) {
    const prefab = assets.instance('foundry-kit', part).object;
    prefab.updateMatrixWorld(true);
    const parts = new Map<T.Material, T.BufferGeometry[]>();
    prefab.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const m = Array.isArray(object.material) ? object.material[0] : object.material;
      const g = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const list = parts.get(m) ?? [];
      list.push(g);
      parts.set(m, list);
    });
    const dummy = new T.Object3D();
    for (const [m, geometries] of parts) {
      const geometry = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      if (!geometry) throw Error('Foundry kit geometry merge failed');
      const shadow = part === 'core-crown';
      const key = m.uuid + ':' + shadow;
      const collected = this.staticParts.get(key) ?? { material: m, geometries: [], shadow };
      placements.forEach((p) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.yaw ?? 0, 0);
        dummy.scale.setScalar(p.scale ?? 1);
        dummy.updateMatrix();
        collected.geometries.push(geometry.clone().applyMatrix4(dummy.matrix));
      });
      geometry.dispose();
      this.staticParts.set(key, collected);
    }
  }
  private sign(
    title: string,
    subtitle: string,
    accent: string,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#1b2945';
    c.fillRect(0, 0, 1024, 256);
    c.fillStyle = accent;
    c.fillRect(0, 0, 14, 256);
    c.fillRect(46, 202, 930, 3);
    c.fillStyle = '#dce4e7';
    c.font = '700 66px sans-serif';
    c.fillText(title, 44, 111);
    c.fillStyle = accent;
    c.font = '500 29px sans-serif';
    c.fillText(subtitle, 48, 165);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    this.textures.push(texture);
    const m = this.material(
      new T.MeshStandardMaterial({
        map: texture,
        roughness: 0.72,
        metalness: 0.12,
        emissive: '#557080',
        emissiveMap: texture,
        emissiveIntensity: 0.18,
      }),
    );
    const mesh = new T.Mesh(this.geometry(new T.PlaneGeometry(3.8, 0.95)), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.root.add(mesh);
  }
  setTextureQuality(quality: FoundryTextureQuality) {
    const maps = this.floorMaps.get(quality);
    if (!maps) return;
    for (const m of this.floors) {
      if (m.map === maps[0]) continue;
      const first = !m.map;
      m.map = maps[0];
      m.normalMap = maps[1];
      m.roughnessMap = maps[2];
      if (first) m.needsUpdate = true;
    }
  }
  setDetail(quality: 'low' | 'medium' | 'high') {
    this.detail.visible = quality !== 'low';
  }
  actorContact() {
    const mesh = new T.Mesh(this.geometry(new T.PlaneGeometry(0.9, 0.75)), this.shadowMaterial!);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    return mesh;
  }
  dispose() {
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent();
  }
}
