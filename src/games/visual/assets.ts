import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { RenderTier } from './quality';
export interface RaceAssets {
  car: GLTF;
  district: GLTF;
  districtLow: GLTF;
  environment: THREE.DataTexture;
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  loadedMs: number;
}
export async function loadRaceAssets(
  tier: RenderTier,
  progress: (value: number) => void,
): Promise<RaceAssets> {
  const start = performance.now(),
    manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => progress(Math.min(98, (loaded / total) * 100));
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder),
    texture = new THREE.TextureLoader(manager);
  const level = tier === 'low' ? 'low' : 'high';
  const districtPromise = loader.loadAsync(`/game-assets/district-${level}.glb`);
  const [car, district, districtLow, environment, color, normal, roughness] = await Promise.all([
    loader.loadAsync(`/game-assets/car-${level}.glb`),
    districtPromise,
    tier === 'low' ? districtPromise : loader.loadAsync('/game-assets/district-low.glb'),
    new HDRLoader(manager).loadAsync('/game-assets/environment.hdr'),
    texture.loadAsync('/game-assets/asphalt-color.webp'),
    texture.loadAsync('/game-assets/asphalt-normal.webp'),
    texture.loadAsync('/game-assets/asphalt-roughness.webp'),
  ]);
  color.colorSpace = THREE.SRGBColorSpace;
  for (const map of [color, normal, roughness]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2.5, 2.5);
    map.anisotropy = tier === 'low' ? 2 : 8;
  }
  // Broad wet patches use a different scale from the fine mineral aggregate.
  roughness.repeat.set(0.2, 0.2);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  progress(100);
  return {
    car,
    district,
    districtLow,
    environment,
    color,
    normal,
    roughness,
    loadedMs: performance.now() - start,
  };
}
export function disposeObjectResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
