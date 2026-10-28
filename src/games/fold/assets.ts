import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {
  Mesh,
  SkinnedMesh,
  Texture,
  type Skeleton,
  type BufferGeometry,
  type Material,
} from 'three';
export class ForgeAssets {
  private assets = new Map<string, GLTF>();
  private disposed = false;
  private skeletons = new Set<Skeleton>();
  async load() {
    const loader = new GLTFLoader();
    await Promise.all(
      ['pilot-cyan', 'pilot-coral', 'vector-r9', 'forge-module', 'fold-node', 'foundry-kit'].map(
        async (name) => {
          const path = name === 'foundry-kit' ? 'foundry/foundry-kit' : name;
          const gltf = await loader.loadAsync(`/game-assets/forge/${path}.glb`);
          this.assets.set(name, gltf);
        },
      ),
    );
    if (this.disposed) this.release();
  }
  instance(name: string, part?: string) {
    const asset = this.assets.get(name);
    if (!asset) throw Error('Forge asset unavailable');
    const source = part ? asset.scene.getObjectByName(part) : asset.scene;
    if (!source) throw Error('Forge architectural part unavailable');
    const object = clone(source);
    object.traverse((o) => {
      if (o instanceof SkinnedMesh) this.skeletons.add(o.skeleton);
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return { object, clips: asset.animations };
  }
  private release() {
    const geometries = new Set<BufferGeometry>(),
      materials = new Set<Material>();
    const textures = new Set<Texture>();
    for (const gltf of this.assets.values())
      gltf.scene.traverse((o) => {
        if (o instanceof Mesh) {
          geometries.add(o.geometry);
          for (const material of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(material);
        }
      });
    for (const g of geometries) g.dispose();
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
      m.dispose();
    }
    for (const texture of textures) texture.dispose();
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.skeletons.clear();
    this.assets.clear();
  }
  dispose() {
    this.disposed = true;
    this.release();
  }
}
