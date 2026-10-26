import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { qualityPresets, type RenderTier } from './quality';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { prepareTexture } from './texture-budget';
import manifest from '../../../public/game-assets/graphics-manifest.json';
import { vehicles, type VehicleId } from '../vehicles/config';
import trackManifest from '../../../public/game-assets/track-manifest.json';
import { getTrack, type TrackId } from '../tracks/registry';
import { batchStaticMeshes } from './geometry';
// The fixed static worker has its own restricted policy. The application
// document keeps its existing no-eval policy and never executes user code.
class StaticKTX2Loader extends KTX2Loader {
  override init() {
    return super.init().then(() => {
      this.workerPool.setWorkerCreator(() => {
        const worker = new Worker(manifest.basisWorker);
        const transcoderBinary = this.transcoderBinary!.slice(0);
        worker.postMessage({ type: 'init', config: this.workerConfig, transcoderBinary }, [
          transcoderBinary,
        ]);
        return worker;
      });
    });
  }
}
export interface RaceAssets {
  trackProps: Record<string, GLTF>;
  vehicles: Record<VehicleId, GLTF>;
  car: GLTF;
  carLow: GLTF;
  districtMedium: GLTF;
  pavement: { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };
  assetFormat: string;
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
  renderer?: THREE.WebGLRenderer,
  preferCompressed = true,
  trackId?: TrackId,
): Promise<RaceAssets> {
  const start = performance.now(),
    manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => progress(Math.min(98, (loaded / total) * 100));
  const ktx =
    renderer && preferCompressed && tier !== 'low'
      ? new StaticKTX2Loader(manager)
          .setTranscoderPath(manifest.basisPath)
          .setWorkerLimit(2)
          .detectSupport(renderer)
      : undefined;
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  if (ktx) loader.setKTX2Loader(ktx);
  const texture = new THREE.TextureLoader(manager);
  const compressed = !!ktx;
  const choose = (asset: { ktx2: string; fallback: string }) =>
    compressed ? asset.ktx2 : asset.fallback;
  const low = tier === 'low',
    medium = tier === 'medium';
  // Texture and geometry tiers are selected before a race, never swapped during
  // a corner. Content hashes allow ordinary browser/CDN caching without stale assets.
  const districts = manifest.district as typeof manifest.district & {
    ultra?: { ktx2: string; fallback: string };
  };
  const districtPack = medium
    ? districts.medium
    : (tier === 'ultra' || tier === 'cinematic') && districts.ultra
      ? districts.ultra
      : districts.high;
  const districtPromise = loader.loadAsync(
    low || trackId ? '/game-assets/district-low.glb' : choose(districtPack),
  );
  const lowPromise =
    low || trackId ? districtPromise : loader.loadAsync('/game-assets/district-low.glb');
  const carLowPromise = loader.loadAsync('/game-assets/car-low.glb');
  const vehicleModels = Promise.all(
    vehicles
      .filter((v) => v.modelAsset !== 'concept')
      .map(async (v) => [v.vehicleId, await loader.loadAsync(v.modelAsset)] as const),
  );
  const propModels = Promise.all(
    Object.entries(trackManifest.models)
      .filter(
        ([, asset]) =>
          !!trackId &&
          (asset.pack === (getTrack(trackId).environment === 'circuit' ? 'racing' : 'nature') ||
            (asset.pack === 'racing' &&
              (asset.path.includes('lightPostModern') || asset.path.includes('barrierWall')))),
      )
      .map(async ([key, asset]) => [key, await loader.loadAsync(asset.path)] as const),
  );
  const surface = async (kind: 'asphalt' | 'pavement') => {
    const load = (role: 'color' | 'normal' | 'roughness') =>
      low
        ? texture.loadAsync(`/game-assets/asphalt-${role}.webp`)
        : compressed
          ? ktx!.loadAsync(manifest.surfaces[kind][role].ktx2)
          : texture.loadAsync(manifest.surfaces[kind][role].webp);
    const [color, normal, roughness] = await Promise.all([
      load('color'),
      load('normal'),
      load('roughness'),
    ]);
    color.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = roughness.colorSpace = THREE.NoColorSpace;
    for (const map of [color, normal, roughness]) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1, 1);
      prepareTexture(
        map,
        qualityPresets[tier].textureSize,
        Math.min(qualityPresets[tier].anisotropy, renderer?.capabilities.getMaxAnisotropy() ?? 8),
      );
    }
    return { color, normal, roughness };
  };
  try {
    const [car, carLow, district, districtMedium, districtLow, environment, asphalt, pavement] =
      await Promise.all([
        low
          ? carLowPromise
          : loader.loadAsync(medium ? '/game-assets/car-high.glb' : choose(manifest.car)),
        carLowPromise,
        districtPromise,
        low || trackId
          ? lowPromise
          : medium
            ? districtPromise
            : loader.loadAsync(choose(manifest.district.medium)),
        lowPromise,
        new HDRLoader(manager).loadAsync('/game-assets/environment.hdr'),
        surface('asphalt'),
        surface('pavement'),
      ]);
    const extraVehicles = await vehicleModels;
    const trackProps = Object.fromEntries(await propModels);
    // Merge rigid prop panels by material once before their first GPU upload.
    // Each spatial cluster then instances a complete object, not every tiny panel.
    for (const gltf of Object.values(trackProps)) batchStaticMeshes(gltf.scene);
    for (const gltf of [
      car,
      carLow,
      district,
      districtMedium,
      districtLow,
      ...extraVehicles.map((v) => v[1]),
      ...Object.values(trackProps),
    ])
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh)
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            for (const v of Object.values(m))
              if (v instanceof THREE.Texture)
                prepareTexture(
                  v,
                  qualityPresets[tier].textureSize,
                  Math.min(
                    qualityPresets[tier].anisotropy,
                    renderer?.capabilities.getMaxAnisotropy() ?? 8,
                  ),
                );
      });
    environment.mapping = THREE.EquirectangularReflectionMapping;
    progress(100);
    return {
      trackProps,
      vehicles: Object.fromEntries([['meridian-r6', car], ...extraVehicles]) as Record<
        VehicleId,
        GLTF
      >,
      car,
      carLow,
      district,
      districtMedium,
      districtLow,
      environment,
      ...asphalt,
      pavement,
      assetFormat: compressed ? 'KTX2/Basis + Meshopt' : 'WebP + Meshopt',
      loadedMs: performance.now() - start,
    };
  } catch (error) {
    if (ktx) {
      manager.onProgress = () => {};
      return loadRaceAssets(tier, progress, renderer, false, trackId);
    }
    throw error;
  } finally {
    ktx?.dispose();
  }
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

export function disposeRaceAssets(assets: RaceAssets, scene = new THREE.Scene()) {
  scene.add(
    ...Object.values(assets.trackProps).map((p) => p.scene),
    ...Object.values(assets.vehicles).map((v) => v.scene),
    assets.car.scene,
    assets.carLow.scene,
    assets.district.scene,
    assets.districtMedium.scene,
    assets.districtLow.scene,
  );
  disposeObjectResources(scene);
  assets.environment.dispose();
  for (const map of [
    assets.color,
    assets.normal,
    assets.roughness,
    ...Object.values(assets.pavement),
  ])
    map.dispose();
}
