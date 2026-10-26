// Separate compatibility build, never a replacement game or a fake race.
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { loadRaceAssets } from '../src/games/visual/assets';
import { createCar } from '../src/games/visual/car';
import { createCityWorld } from '../src/games/visual/city-world';
const report = {
  ready: false,
  available: false,
  actualBackend: 'unknown',
  productionCompatible: false,
  notes: [] as string[],
  frames: [] as number[],
};
Object.assign(window, { webgpuProbe: report });
try {
  const renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();
  report.actualBackend = (renderer.backend as unknown as { isWebGPUBackend?: boolean })
    .isWebGPUBackend
    ? 'webgpu'
    : 'webgl2-fallback';
  report.available = report.actualBackend === 'webgpu';
  renderer.setSize(innerWidth, innerHeight);
  document.body.append(renderer.domElement);
  const assets = await loadRaceAssets('high', () => {}),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 200);
  scene.add(
    new THREE.HemisphereLight('#b3c4d8', '#555044', 1),
    new THREE.DirectionalLight('#fff1dd', 2),
  );
  scene.environment = assets.environment;
  const car = createCar(assets.car.scene);
  scene.add(car.group);
  camera.layers.enable(1);camera.layers.enable(2);
  camera.position.set(-5, 2, -6);
  camera.lookAt(0, 0.8, 0);
  car.group.getObjectByName('Tire_contact_shadow')!.visible = false;
  report.notes.push(
    'PBR car subset excludes the legacy GLSL contact decal; full city compatibility is tested separately.',
  );
  await renderer.compileAsync(scene, camera);
  for (let i = 0; i < 12; i++) {
    const before = performance.now();
    await renderer.renderAsync(scene, camera);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    report.frames.push(performance.now() - before);
  }
  // Test the actual city builder as well: its GLSL hooks and WebGL PMREM must
  // work before the renderer could be selected for the production runtime.
  try {
    createCityWorld(scene, assets, 'high', renderer as unknown as THREE.WebGLRenderer);
    await renderer.renderAsync(scene, camera);
    report.notes.push(
      'Render returned, but GLSL ShaderMaterial/onBeforeCompile and WebGL postprocessing require adaptation; this is not a compatibility pass.',
    );
    report.productionCompatible = false;
  } catch (e) {
    report.notes.push(
      'Existing production graph requires adaptation: ' +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  report.ready = true;
} catch (e) {
  report.notes.push(e instanceof Error ? e.message : String(e));
  report.ready = true;
}
