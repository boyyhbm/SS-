import * as THREE from 'three';
import { loadRaceAssets, disposeRaceAssets } from './assets';
import { createCityWorld } from './city-world';
import { createWorld } from './world';
import { createCar } from './car';
import { initialCityRace } from '../city-driving';
import { initialRace } from '../racing-physics';
import { createRenderPipeline } from './pipeline';
import { qualityPresets } from './quality';
import { calibratedTier } from './adaptive';
import { createTrackWorld } from './track-world';
import type { TrackId } from '../tracks/registry';
import { initialTrackRace } from '../tracks/physics';
// Real startup trials use the same city/car/pipeline at this device's viewport.
// Poor adapters stop after a measured Low trial; they never have to decode the
// entire Medium/High texture set just to discover that it exceeds their budget.
export async function calibrateGraphics(
  renderer: THREE.WebGLRenderer,
  city: boolean,
  progress: (n: number) => void,
  cancelled: () => boolean,
  trackId?: TrackId,
) {
  const trials: {
    tier: string;
    samplesMs: number[];
    frameIntervalsMs: number[];
    earlyExit: boolean;
  }[] = [];
  const measure = async (tier: 'low' | 'medium') => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityPresets[tier].dpr));
    const assets = await loadRaceAssets(
      tier,
      (n) => progress(n * 0.3 + (tier === 'medium' ? 25 : 0)),
      renderer,
      true,
      trackId,
    );
    if (cancelled()) {
      disposeRaceAssets(assets);
      return [];
    }
    renderer.shadowMap.enabled = tier !== 'low';
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(
        58,
        renderer.domElement.width / renderer.domElement.height,
        0.15,
        tier === 'low' ? 140 : 350,
      );
    camera.layers.enable(1);
    camera.layers.enable(2);
    const race = trackId
        ? initialTrackRace(trackId)
        : city
          ? initialCityRace('downtown-circuit')
          : initialRace(),
      world = trackId
        ? createTrackWorld(scene, assets, tier, renderer, trackId)
        : city
          ? createCityWorld(scene, assets, tier, renderer)
          : createWorld(scene, assets, tier, renderer);
    const car = createCar(assets.car.scene, tier === 'low');
    car.group.position.set(race.x, (race.y ?? 0) + 0.03, race.z);
    car.group.rotation.y = race.heading;
    scene.add(car.group);
    camera.position.set(race.x - 5, (race.y ?? 0) + 3, race.z - 8);
    camera.lookAt(race.x, (race.y ?? 0) + 1, race.z + 8);
    world.update(race, false, 0, false);
    const pipeline = createRenderPipeline(renderer, scene, camera, tier, tier, assets.loadedMs),
      samples: number[] = [],
      frameIntervals: number[] = [];
    let lastFrameAt = 0;
    try {
      await renderer.compileAsync(scene, camera);
      for (let i = 0; i < 10 && !cancelled(); i++) {
        const frameAt = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        if (i >= 2 && lastFrameAt) frameIntervals.push(frameAt - lastFrameAt);
        lastFrameAt = frameAt;
        const start = performance.now();
        pipeline.render(false, {
          physicsMs: 0,
          physicsSteps: 0,
          alpha: 0,
          networkDelayMs: 0,
          snapshotAgeMs: 0,
        });
        // Completion wait exists only in startup calibration, never while driving.
        renderer.getContext().finish();
        if (i >= 2) samples.push(performance.now() - start);
        progress(30 + i * 2 + (tier === 'medium' ? 25 : 0));
        if (samples.length >= 2 && samples.every((n) => n > 100)) break;
      }
    } finally {
      pipeline.dispose();
      world.dispose();
      car.dispose();
      disposeRaceAssets(assets, scene);
    }
    trials.push({
      tier,
      samplesMs: samples,
      frameIntervalsMs: frameIntervals,
      earlyExit: samples.length < 8,
    });
    return samples;
  };
  let selected: 'low' | 'medium' | 'high' = 'low';
  let samples = await measure('low');
  if (samples.length === 8 && samples.reduce((a, b) => a + b, 0) / 8 < 12 && !cancelled()) {
    samples = await measure('medium');
    selected = calibratedTier(samples, renderer.capabilities.maxTextureSize);
  }
  const result = {
    selected,
    samplesMs: samples,
    trials,
    viewport: [renderer.domElement.width, renderer.domElement.height],
    sampleKind: 'short actual-scene startup calibration; not steady-state FPS certification',
  };
  renderer.domElement.dataset.calibration = JSON.stringify(result);
  window.dispatchEvent(new CustomEvent('nexus-graphics-calibration', { detail: result }));
  return selected;
}
