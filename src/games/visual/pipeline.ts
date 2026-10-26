import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { qualityPresets, useRenderSettings, type RenderQuality, type RenderTier } from './quality';
import { AdaptiveGraphics } from './adaptive';
import { GpuTimer } from './gpu-timer';
export function createRenderPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  tier: RenderTier,
  requested: RenderQuality,
  loadMs: number,
) {
  renderer.info.autoReset = false;
  const preset = qualityPresets[tier];
  const gpuTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  const adaptive = new AdaptiveGraphics(preset.bloom ? 2 : 0);
  const baseRatio = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  const hdr = !!renderer.extensions.get('EXT_color_buffer_float');
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const sampleCounts = Array.from(
    gl.getInternalformatParameter(
      gl.RENDERBUFFER,
      hdr ? gl.RGBA16F : gl.RGBA8,
      gl.SAMPLES,
    ) as Int32Array,
  );
  const samples = sampleCounts.filter((n) => n <= preset.samples).sort((a, b) => b - a)[0] ?? 0;
  let composer: EffectComposer | undefined;
  const aoCamera = camera.clone();
  aoCamera.layers.set(0);
  aoCamera.layers.enable(1);
  let bloom: UnrealBloomPass | undefined, ao: GTAOPass | undefined;
  let grade: ShaderPass | undefined;
  if (preset.bloom) {
    // Canvas MSAA does not antialias composer render targets. Allocate the
    // actual HDR intermediate with supported multisampling instead.
    const target = new THREE.WebGLRenderTarget(size.x * baseRatio, size.y * baseRatio, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    if (preset.ao && hdr) {
      ao = new GTAOPass(scene, aoCamera, size.x / 2, size.y / 2);
      ao.updateGtaoMaterial({ radius: 0.65, distanceExponent: 1, thickness: 1, samples: 8 });
      ao.updatePdMaterial({ samples: 8, rings: 2, radius: 4 });
      ao.blendIntensity = 0.32;
      composer.addPass(ao);
    }
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.45, 1.4);
    composer.addPass(bloom);
    grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, intensity: { value: 0.7 } },
      vertexShader:
        'varying vec2 uvGrade;void main(){uvGrade=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:
        'uniform sampler2D tDiffuse;uniform float intensity;varying vec2 uvGrade;void main(){vec4 c=texture2D(tDiffuse,uvGrade);vec3 balanced=c.rgb*vec3(1.015,1.0,0.99);balanced+=vec3(0.001,0.0018,0.0025)/(1.+c.rgb*8.);gl_FragColor=vec4(mix(c.rgb,balanced,intensity),c.a);}',
    });
    grade.material.toneMapped = false;
    composer.addPass(grade);
    // Spatial AA only: no camera jitter, motion-vector history or light trails.
    if (tier === 'cinematic' || samples === 0) composer.addPass(new SMAAPass());
    composer.addPass(new OutputPass());
  }
  const resizeEffects = () => {
    bloom?.setSize(Math.max(1, size.x * dpr * 0.5), Math.max(1, size.y * dpr * 0.5));
    ao?.setSize(Math.max(1, size.x * dpr * 0.5), Math.max(1, size.y * dpr * 0.5));
  };
  let last = 0,
    statsAt = performance.now(),
    dpr = renderer.getPixelRatio(),
    previouslyPaused = true;
  resizeEffects();
  const frames: number[] = [],
    cpu: number[] = [],
    mainThread: number[] = [],
    physics: number[] = [],
    gpu: number[] = [];
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
        mainThreadStartedAt?: number;
        physicsMs: number;
        physicsSteps: number;
        alpha: number;
        networkDelayMs: number;
        snapshotAgeMs: number;
      },
    ) {
      const now = performance.now();
      if (paused || previouslyPaused !== paused) {
        gpuTimer.reset();
        gpu.length = 0;
        last = 0;
        frames.length = 0;
        cpu.length = 0;
        mainThread.length = 0;
        physics.length = 0;
        simulatedSteps = 0;
        statsAt = now;
      }
      previouslyPaused = paused;
      if (last) frames.push(now - last);
      last = now;
      renderer.info.reset();
      const settings = useRenderSettings.getState(),
        intensity = settings.postIntensity ?? 0.7;
      if (grade) grade.uniforms.intensity.value = intensity;
      if (ao) {
        aoCamera.copy(camera, false);
        aoCamera.layers.set(0);
        aoCamera.layers.enable(1);
        ao.blendIntensity = 0.32 * intensity;
        ao.enabled = intensity > 0 && adaptive.effects >= 2;
      }
      if (bloom) {
        bloom.strength = 0.28 * intensity * (adaptive.effects === 1 ? 0.5 : 1);
        bloom.enabled = intensity > 0 && adaptive.effects > 0;
      }
      if (!paused) gpuTimer.begin();
      const start = performance.now();
      if (composer) composer.render();
      else renderer.render(scene, camera);
      cpu.push(performance.now() - start);
      mainThread.push(performance.now() - (timing.mainThreadStartedAt ?? start));
      if (!paused) gpuTimer.end();
      const measuredGpu = gpuTimer.poll();
      if (measuredGpu !== null) gpu.push(measuredGpu);
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
          gpuFrameMs: gpu.length ? mean(gpu) : null,
          gpuTimerAvailable: gpuTimer.available,
          rendererBackend: 'WebGL2',
          hdrIntermediate: !!composer && hdr,
          antialiasing: composer
            ? [
                samples ? `MSAA ${samples}` : '',
                tier === 'cinematic' || samples === 0 ? 'SMAA' : '',
              ]
                .filter(Boolean)
                .join(' + ')
            : 'none',
          effectsBudget: adaptive.effects,
          dynamicResolutionScale: adaptive.scale,
          frameP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
          frameTimesMs: [...frames],
          renderCpuMs: mean(cpu),
          frameMainThreadMs: mean(mainThread),
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
        if ((requested === 'auto' || settings.dynamicResolution) && !paused && !document.hidden) {
          if (
            adaptive.observe(
              {
                frameMs: detail.frameMs,
                p95Ms: detail.frameP95Ms,
                lowFps: detail.fps1PercentLow,
                cpuMs: detail.renderCpuMs,
                gpuMs: detail.gpuFrameMs,
                spikes: detail.frameSpikesOver50Ms,
                samples: frames.length,
              },
              now,
            )
          ) {
            dpr = baseRatio * adaptive.scale;
            renderer.setPixelRatio(dpr);
            composer?.setPixelRatio(dpr);
            resizeEffects();
          }
        }
        frames.length = 0;
        cpu.length = 0;
        mainThread.length = 0;
        physics.length = 0;
        gpu.length = 0;
        simulatedSteps = 0;
        statsAt = now;
      }
    },
    resize(w: number, h: number) {
      size.set(w, h);
      composer?.setSize(w, h);
      resizeEffects();
    },
    dispose() {
      window.removeEventListener('keydown', toggle);
      overlay.remove();
      gpuTimer.dispose();
      composer?.passes.forEach((p) => p.dispose());
      composer?.dispose();
    },
  };
}
