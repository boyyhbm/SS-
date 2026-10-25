import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { qualityPresets, type RenderQuality, type RenderTier } from './quality';
export function createRenderPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  tier: RenderTier,
  requested: RenderQuality,
  loadMs: number,
) {
  renderer.info.autoReset = false;
  let composer: EffectComposer | undefined;
  if (qualityPresets[tier].bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(640, 360), 0.25, 0.55, 1.15));
    composer.addPass(new OutputPass());
  }
  let last = 0,
    statsAt = performance.now(),
    dpr = renderer.getPixelRatio(),
    slow = 0,
    previouslyPaused = true;
  const frames: number[] = [],
    cpu: number[] = [],
    physics: number[] = [];
  let simulatedSteps = 0;
  const overlay = document.createElement('output');
  overlay.className = 'race-developer-overlay';
  overlay.hidden = new URLSearchParams(location.search).get('developer') !== '1';
  overlay.setAttribute('aria-label', 'Developer performance diagnostics');
  renderer.domElement.parentElement?.appendChild(overlay);
  const toggle = (event: KeyboardEvent) => {
    if (event.code === 'F3') {
      event.preventDefault();
      overlay.hidden = !overlay.hidden;
    }
  };
  window.addEventListener('keydown', toggle);
  const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
  return {
    render(
      paused: boolean,
      timing: {
        physicsMs: number;
        physicsSteps: number;
        alpha: number;
        networkDelayMs: number;
        snapshotAgeMs: number;
      },
    ) {
      const now = performance.now();
      if (paused || previouslyPaused !== paused) {
        last = 0;
        frames.length = 0;
        cpu.length = 0;
        physics.length = 0;
        simulatedSteps = 0;
        statsAt = now;
      }
      previouslyPaused = paused;
      if (last) frames.push(now - last);
      last = now;
      renderer.info.reset();
      const start = performance.now();
      if (composer) composer.render();
      else renderer.render(scene, camera);
      cpu.push(performance.now() - start);
      physics.push(timing.physicsMs);
      simulatedSteps += timing.physicsSteps;
      if (!paused && frames.length >= 2 && now - statsAt > 1000) {
        const resources = performance
          .getEntriesByType('resource')
          .filter((e) => e.name.includes('/game-assets/')) as PerformanceResourceTiming[];
        const sorted = [...frames].sort((a, b) => a - b);
        const detail = {
          quality: tier,
          requestedQuality: requested,
          fps: 1000 / Math.max(1, mean(frames)),
          frameMs: mean(frames),
          fps1PercentLow:
            1000 / Math.max(1, mean(sorted.slice(-Math.max(1, Math.ceil(sorted.length * 0.01))))),
          frameMaxMs: sorted.at(-1) ?? 0,
          frameSpikesOver50Ms: frames.filter((n) => n > 50).length,
          physicsCpuMsPerStep: physics.reduce((s, n) => s + n, 0) / Math.max(1, simulatedSteps),
          physicsSteps: simulatedSteps,
          interpolationAlpha: timing.alpha,
          networkInterpolationDelayMs: timing.networkDelayMs,
          networkSnapshotAgeMs: timing.snapshotAgeMs,
          gpuMemory: 'UNAVAILABLE_WEBGL',
          frameP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
          frameTimesMs: [...frames],
          renderCpuMs: mean(cpu),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          textures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries,
          pixelRatio: dpr,
          loadMs,
          resourceTransferBytes: resources.reduce((s, e) => s + e.transferSize, 0),
          resourceDecodedBytes: resources.reduce((s, e) => s + e.decodedBodySize, 0),
          paused,
        };
        window.dispatchEvent(new CustomEvent('nexus-render-stats', { detail }));
        overlay.textContent = `FPS ${detail.fps.toFixed(1)} · 1% ${detail.fps1PercentLow.toFixed(1)}
Frame ${detail.frameMs.toFixed(2)} ms · p95 ${detail.frameP95Ms.toFixed(2)} · max ${detail.frameMaxMs.toFixed(2)}
Physics ${detail.physicsCpuMsPerStep.toFixed(3)} ms/step · 30 Hz
Render CPU ${detail.renderCpuMs.toFixed(2)} ms · calls ${detail.drawCalls}
Network buffer ${detail.networkInterpolationDelayMs} ms · age ${detail.networkSnapshotAgeMs.toFixed(0)} ms · DPR ${dpr.toFixed(2)}`;
        renderer.domElement.dataset.fps = detail.fps.toFixed(1);
        renderer.domElement.dataset.drawCalls = String(detail.drawCalls);
        if (requested === 'auto' && !paused && !document.hidden) {
          slow = detail.frameMs > 18.5 ? slow + 1 : 0;
          if (slow >= 3 && dpr > 0.6) {
            dpr = Math.max(0.6, dpr - 0.15);
            renderer.setPixelRatio(dpr);
            composer?.setPixelRatio(dpr);
            slow = 0;
          }
        }
        frames.length = 0;
        cpu.length = 0;
        physics.length = 0;
        simulatedSteps = 0;
        statsAt = now;
      }
    },
    resize(w: number, h: number) {
      composer?.setSize(w, h);
    },
    dispose() {
      window.removeEventListener('keydown', toggle);
      overlay.remove();
      composer?.passes.forEach((p) => p.dispose());
      composer?.dispose();
    },
  };
}
