// Loopback-only graphics laboratory. Synthetic car poses measure rendering load;
// they are deliberately NOT multiplayer, gameplay, or server-verified race proof.
import * as THREE from 'three';
import { loadRaceAssets } from '../src/games/visual/assets';
import { createCityWorld } from '../src/games/visual/city-world';
import { createCar } from '../src/games/visual/car';
import { createRenderPipeline } from '../src/games/visual/pipeline';
import type { RenderTier } from '../src/games/visual/quality';
import { createLocalReflections } from '../src/games/visual/reflections';
import { initialCityRace } from '../src/games/city-driving';
const query = new URLSearchParams(location.search);
const tier = (query.get('tier') ?? 'high') as RenderTier;
const errors: string[] = [];
const state = initialCityRace('downtown-circuit');
const lab = {
  ready: false,
  errors,
  scene: '',
  tier,
  frames: [] as number[],
  backend: 'WebGL2',
  calls: 0,
  triangles: 0,
};
Object.assign(window, { graphicsLab: lab });
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  preserveDrawingBuffer: false,
});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping =
  query.get('reference') === 'before' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = tier !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.append(renderer.domElement);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.15, 600);
camera.layers.enable(1);
camera.layers.enable(2);
const assets = await loadRaceAssets(tier, () => {}, renderer);
const world = createCityWorld(scene, assets, tier, renderer);
const cars = Array.from({ length: 6 }, () => createCar(assets.car.scene, tier === 'low'));
cars.forEach((c) => scene.add(c.group));
const pipeline = createRenderPipeline(renderer, scene, camera, tier, tier, assets.loadedMs);
const fixed = {
  showcase: { x: -160, z: -64, yaw: 0, camera: [-164.5, 1.6, -70], look: [-160, 0.8, -64] },
  downtown: { x: -95, z: 20, yaw: Math.PI / 2, camera: [-104, 3.1, 17], look: [-76, 1, 20] },
  speed: { x: 45, z: -100, yaw: Math.PI / 2, camera: [37.2, 2.8, -100], look: [60, 1, -100] },
  corner: { x: -40, z: 8, yaw: 0, camera: [-43, 3.2, -1], look: [-40, 1, 28] },
  multiplayer: { x: -160, z: -64, yaw: 0, camera: [-165, 3.6, -76], look: [-160, 1, -47] },
};
function select(name: keyof typeof fixed, count = 1) {
  const p = fixed[name];
  if (!p || count < 1 || count > 6) throw Error('Unknown graphics fixture');
  Object.assign(state, { x: p.x, z: p.z, heading: p.yaw });
  cars.forEach((c, i) => {
    c.group.visible = i < count;
    c.group.position.set(p.x + (i % 2) * 3.5, 0.04, p.z + Math.floor(i / 2) * 7);
    c.group.rotation.y = p.yaw;
    c.update(0, 0, i === 0, false, 0, i % 2 ? 'violet' : 'silver');
  });
  camera.position.fromArray(p.camera);
  camera.lookAt(new THREE.Vector3().fromArray(p.look));
  camera.updateMatrixWorld();
  world.prepareCapture();
  world.update(state, false, 0, false);
  bindings.forEach((b, i) => b?.update(cars[i].group.position.x, cars[i].group.position.z, 10));
  roadBinding?.update(p.x, p.z, 10);
  lab.scene = name;
  lab.frames.length = 0;
}
const probes = await createLocalReflections(
  renderer,
  scene,
  tier,
  (x, z) => {
    world.prepareCapture();
    world.update({ ...state, x, z }, false, 0, false);
  },
  () => {},
);
const bindings = cars.map((c) => probes?.bind(c.materials));
const roadBinding = probes?.bind(world.reflectionMaterials);
Object.assign(lab, { select });
select((query.get('scene') ?? 'showcase') as keyof typeof fixed, Number(query.get('cars') ?? 1));
// Compile the actual scene before recording frame intervals. No simulation state
// or account is modified in this lab and no synthetic actors enter a game server.
await renderer.compileAsync(scene, camera);
let previous = 0;
function frame(now: number) {
  if (previous && lab.frames.length < 10000) lab.frames.push(now - previous);
  previous = now;
  pipeline.render(false, {
    physicsMs: 0,
    physicsSteps: 0,
    alpha: 0,
    networkDelayMs: 0,
    snapshotAgeMs: 0,
  });
  lab.calls = renderer.info.render.calls;
  lab.triangles = renderer.info.render.triangles;
  lab.ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
