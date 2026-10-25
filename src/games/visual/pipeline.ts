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
    slow = 0;
  let frames: number[] = [],
    cpu: number[] = [];
  const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
  return {
    render(paused: boolean) {
      const now = performance.now();
      if (last) frames.push(now - last);
      last = now;
      renderer.info.reset();
      const start = performance.now();
      if (composer) composer.render();
      else renderer.render(scene, camera);
      cpu.push(performance.now() - start);
      if (now - statsAt > 1000) {
        const resources = performance
          .getEntriesByType('resource')
          .filter((e) => e.name.includes('/game-assets/')) as PerformanceResourceTiming[];
        const sorted = [...frames].sort((a, b) => a - b);
        const detail = {
          quality: tier,
          requestedQuality: requested,
          fps: 1000 / Math.max(1, mean(frames)),
          frameMs: mean(frames),
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
        frames = [];
        cpu = [];
        statsAt = now;
      }
    },
    resize(w: number, h: number) {
      composer?.setSize(w, h);
    },
    dispose() {
      composer?.passes.forEach((p) => p.dispose());
      composer?.dispose();
    },
  };
}
