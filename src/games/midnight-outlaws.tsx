'use client';
import { nexusInput } from '../input/manager';
import { FixedStepClock } from './fixed-clock';
import { useEffect, useRef, useState } from 'react';
import type { RaceNetworkDriver } from '../multiplayer/prediction';
import * as THREE from 'three';
import { loadRaceAssets, disposeObjectResources } from './visual/assets';
import { createWorld } from './visual/world';
import { createCar, type CarVisual } from './visual/car';
import { qualityPresets, useRenderSettings, type RenderTier } from './visual/quality';
import { createRenderPipeline } from './visual/pipeline';
import { useUI } from '../lib/ui-store';
import { initialRace, stepRace, type RaceInput, type RaceState } from './racing-physics';
export interface RaceTelemetry {
  speed: number;
  nitro: number;
  lap: number;
  lapTime: number;
  bestLap: number | null;
  nextCheckpoint: number;
  collision: boolean;
  x: number;
  z: number;
  heading: number;
}
export function MidnightOutlaws({
  language,
  presentationKey = 'single',
  paused,
  onReady,
  onError,
  onLap,
  onTelemetry,
  inputRef,
  onPause,
  restartKey,
  initialBestLap,
  networkRef,
}: {
  language: 'ru' | 'en';
  presentationKey?: string;
  paused: boolean;
  onReady: () => void;
  onError: () => void;
  onLap: (time: number) => void;
  onTelemetry: (state: RaceTelemetry) => void;
  inputRef: React.RefObject<RaceInput>;
  onPause: () => void;
  restartKey: number;
  initialBestLap: number | null;
  networkRef?: React.RefObject<RaceNetworkDriver | null>;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<RaceState>({ ...initialRace(), bestLap: initialBestLap }),
    pausedRef = useRef(paused);
  const quality = useRenderSettings((s) => s.quality);
  const [loading, setLoading] = useState(0),
    [failure, setFailure] = useState(false);
  const callbacks = useRef({ onReady, onError, onLap, onTelemetry, onPause });
  const presentation = useRef(presentationKey);
  useEffect(() => {
    presentation.current = presentationKey;
  }, [presentationKey]);
  useEffect(() => {
    callbacks.current = { onReady, onError, onLap, onTelemetry, onPause };
  }, [onReady, onError, onLap, onTelemetry, onPause]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    state.current = { ...initialRace(), bestLap: state.current.bestLap ?? initialBestLap };
  }, [restartKey, initialBestLap]);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let cancelled = false,
      disposeScene = () => {};
    setLoading(0);
    setFailure(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
    } catch {
      callbacks.current.onError();
      return;
    }
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    const device = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    const tier: RenderTier =
      quality === 'auto'
        ? /swiftshader|llvmpipe|software/i.test(device) || window.innerWidth < 700
          ? 'low'
          : 'medium'
        : quality;
    const preset = qualityPresets[tier];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = preset.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'MIDNIGHT OUTLAWS WebGL game');
    renderer.domElement.tabIndex = 0;
    renderer.domElement.dataset.quality = tier;
    container.appendChild(renderer.domElement);
    disposeScene = () => {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    void (async () => {
      const assets = await loadRaceAssets(tier, (v) => {
        if (!cancelled) setLoading(Math.min(99, v));
      });
      if (cancelled) {
        const all = new THREE.Group();
        all.add(assets.car.scene, assets.district.scene, assets.districtLow.scene);
        disposeObjectResources(all);
        assets.environment.dispose();
        return;
      }
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        58,
        container.clientWidth / container.clientHeight,
        0.15,
        preset.cityDistance,
      );
      const world = createWorld(scene, assets, tier, renderer);
      const visual = createCar(assets.car.scene, tier === 'low'),
        car = visual.group;
      scene.add(car);
      const pipeline = createRenderPipeline(
        renderer,
        scene,
        camera,
        tier,
        quality,
        assets.loadedMs,
      );
      const remoteCars = new Map<string, CarVisual>();
      let previousFrame = performance.now();
      let frame = 0,
        lastHud = 0,
        renderDirty = true,
        ready = false;
      let cameraMode = 0;
      let renderedPresentation = '';
      let previousLap = state.current.lap;
      const clock = new FixedStepClock();
      let previousTick = performance.now(),
        simulationAt = previousTick;
      let previousPose = { ...state.current };
      let drivingInput: RaceInput = { throttle: 0, brake: 0, steer: 0, nitro: false };
      function simulate() {
        const now = performance.now(),
          elapsed = (now - previousTick) / 1000;
        previousTick = now;
        if (cancelled || !ready) {
          clock.reset();
          return;
        }
        const controls = nexusInput.readFresh();
        if (nexusInput.consume('pause', 'midnight') && !pausedRef.current)
          callbacks.current.onPause();
        if (nexusInput.consume('camera', 'midnight') && !pausedRef.current)
          cameraMode = (cameraMode + 1) % 4;
        drivingInput = {
          throttle: Math.max(inputRef.current.throttle, controls.accelerate),
          brake: Math.max(inputRef.current.brake, controls.brake),
          steer: inputRef.current.steer || controls.steer,
          nitro: inputRef.current.nitro || controls.boost > 0.5,
          handbrake: !!inputRef.current.handbrake || controls.handbrake > 0.5,
        };
        renderer.domElement.dataset.throttle = String(drivingInput.throttle);
        renderer.domElement.dataset.brake = String(drivingInput.brake);
        renderer.domElement.dataset.steer = String(drivingInput.steer);
        renderer.domElement.dataset.handbrake = String(!!drivingInput.handbrake);
        const network = networkRef?.current;
        if (pausedRef.current && !network) {
          clock.reset();
          return;
        }
        clock.advance(elapsed, (dt) => {
          previousPose = { ...state.current };
          const race = state.current;
          if (network)
            Object.assign(
              race,
              network.frame(
                pausedRef.current
                  ? { throttle: 0, brake: 1, steer: 0, nitro: false }
                  : drivingInput,
                dt,
              ),
            );
          else {
            const lap = stepRace(race, drivingInput, dt);
            if (lap !== null) callbacks.current.onLap(lap);
          }
          if (race.lap > previousLap) void nexusInput.haptic('finish');
          previousLap = race.lap;
          if (!pausedRef.current) {
            if (race.collision) void nexusInput.haptic('collision');
            else if (drivingInput.nitro && drivingInput.throttle > 0 && race.nitro > 0)
              void nexusInput.haptic('boost');
            else if (drivingInput.throttle > 0.2) void nexusInput.haptic('accelerate');
          }
        });
        simulationAt = now - clock.remainder * 1000;
        if ((!pausedRef.current || network) && now - lastHud > 80) {
          callbacks.current.onTelemetry({ ...state.current });
          lastHud = now;
        }
      }
      const simulationTimer = window.setInterval(simulate, clock.step * 1000);
      const inputEvents = nexusInput.on((event) => {
        if (
          event.type === 'disconnected' &&
          event.active &&
          nexusInput.getSnapshot().method === 'gamepad' &&
          !networkRef?.current &&
          !pausedRef.current
        )
          callbacks.current.onPause();
      });
      const blur = () => {
        if (!pausedRef.current && !networkRef?.current) callbacks.current.onPause();
      };
      window.addEventListener('blur', blur);
      const resize = () => {
        const w = container.clientWidth,
          h = container.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        pipeline.resize(w, h);
        renderDirty = true;
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      const targetPosition = new THREE.Vector3(),
        targetLook = new THREE.Vector3();
      camera.position.set(state.current.x + 1.1, 2.8, state.current.z - 7.6);
      camera.lookAt(state.current.x, 1, state.current.z + 10);
      function animate() {
        if (cancelled) return;
        const now = performance.now();
        const dt = Math.min((now - previousFrame) / 1000, 0.05);
        const current = state.current;
        const alpha =
          pausedRef.current ||
          Math.hypot(current.x - previousPose.x, current.z - previousPose.z) > 8
            ? 1
            : Math.min(1, Math.max(0, (now - simulationAt) / (clock.step * 1000)));
        const angle = Math.atan2(
          Math.sin(current.heading - previousPose.heading),
          Math.cos(current.heading - previousPose.heading),
        );
        const race = {
          ...current,
          x: previousPose.x + (current.x - previousPose.x) * alpha,
          z: previousPose.z + (current.z - previousPose.z) * alpha,
          heading: previousPose.heading + angle * alpha,
        };
        previousFrame = now;
        const input = drivingInput;
        const network = networkRef?.current;
        let sceneKey = `${presentation.current}:${pausedRef.current}`;
        if (network) {
          sceneKey += `:${network.car()}`;
          const peers = network.remotePlayers();
          for (const peer of peers) {
            sceneKey += `:${peer.id}:${peer.car}:${peer.connected}:${peer.finish}`;
            let ghost = remoteCars.get(peer.id);
            if (!ghost) {
              ghost = createCar(assets.car.scene, tier === 'low');
              scene.add(ghost.group);
              remoteCars.set(peer.id, ghost);
            }
            ghost.group.position.set(peer.state.x, 0.025, peer.state.z);
            ghost.group.rotation.y = peer.state.heading;
            ghost.group.visible = peer.connected || peer.finish !== null;
            ghost.update(peer.state.speed, peer.state.steering, false, false, dt, peer.car);
          }
          for (const [id, ghost] of remoteCars)
            if (!peers.some((p) => p.id === id)) {
              scene.remove(ghost.group);
              ghost.dispose();
              remoteCars.delete(id);
            }
        }
        car.position.set(race.x, 0.03, race.z);
        car.rotation.y = race.heading;
        car.rotation.z = -race.steering * race.speed * 0.0016;
        const boost = !pausedRef.current && input.nitro && race.nitro > 0 && race.speed > 4;
        const braking = !pausedRef.current && (input.brake > 0.1 || !!input.handbrake);
        visual.update(
          race.speed,
          race.steering,
          braking,
          boost,
          pausedRef.current ? 0 : dt,
          network?.car(),
        );
        world.update(race, braking, dt, boost);
        container.dataset.boosting = String(boost);
        container.dataset.braking = String(braking);
        targetPosition.set(
          race.x +
            (cameraMode === 0 ? Math.cos(race.heading) * 1.5 : 0) -
            Math.sin(race.heading) * (cameraMode === 0 ? 7.6 : cameraMode === 1 ? 13 : -0.6),
          cameraMode === 0 ? 2.8 : cameraMode === 1 ? 5.6 : 1.12,
          race.z -
            (cameraMode === 0 ? Math.sin(race.heading) * 1.5 : 0) -
            Math.cos(race.heading) * (cameraMode === 0 ? 7.6 : cameraMode === 1 ? 13 : -0.6),
        );
        if (cameraMode === 3)
          targetPosition.set(
            race.x + Math.sin(race.heading) * 5.8 - Math.cos(race.heading) * 5.1,
            1.9,
            race.z + Math.cos(race.heading) * 5.8 + Math.sin(race.heading) * 5.1,
          );
        const reduced =
          useUI.getState().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!ready || reduced) camera.position.copy(targetPosition);
        else if (!pausedRef.current) camera.position.lerp(targetPosition, Math.min(1, dt * 5));
        targetLook.set(
          race.x + Math.sin(race.heading) * 9,
          1.05,
          race.z + Math.cos(race.heading) * 9,
        );
        if (cameraMode === 3)
          targetLook.set(
            race.x - Math.cos(race.heading) * 2.6,
            0.8,
            race.z + Math.sin(race.heading) * 2.6,
          );
        camera.lookAt(targetLook);
        if (!reduced && !pausedRef.current)
          camera.position.y += Math.sin(now * 0.027) * race.speed * 0.0007 * (boost ? 1.8 : 1);
        camera.fov +=
          (58 + race.speed * 0.16 + (boost && !reduced ? 5 : 0) - camera.fov) * Math.min(1, dt * 4);
        camera.updateProjectionMatrix();
        renderer.domElement.dataset.cameraMode = String(cameraMode);
        renderer.domElement.dataset.cameraSettled = String(
          camera.position.distanceTo(targetPosition) < 0.05,
        );
        renderer.domElement.dataset.throttle = String(input.throttle);
        renderer.domElement.dataset.brake = String(input.brake);
        renderer.domElement.dataset.steer = String(input.steer);
        renderer.domElement.dataset.handbrake = String(!!input.handbrake);
        renderer.domElement.dataset.remoteCars = String(remoteCars.size);
        // A single-player pause freezes the world and releases the GPU for console navigation.
        // Idle lobbies redraw when their presentation changes. Network simulation keeps ticking.
        if (sceneKey !== renderedPresentation) renderDirty = true;
        if (!ready || !pausedRef.current || renderDirty) {
          pipeline.render(pausedRef.current);
          renderedPresentation = sceneKey;
          renderDirty = false;
        }
        if (!ready) {
          ready = true;
          setLoading(100);
          renderer.domElement.dataset.assets = 'glb-loaded';
          callbacks.current.onReady();
          callbacks.current.onTelemetry({ ...state.current });
          lastHud = now;
        }
        frame = requestAnimationFrame(animate);
      }
      const contextLost = (e: Event) => {
        e.preventDefault();
        callbacks.current.onError();
      };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      disposeScene = () => {
        cancelAnimationFrame(frame);
        clearInterval(simulationTimer);
        observer.disconnect();
        inputEvents();
        window.removeEventListener('blur', blur);
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        world.dispose();
        pipeline.dispose();
        scene.add(assets.car.scene, assets.district.scene, assets.districtLow.scene);
        disposeObjectResources(scene);
        assets.environment.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      await renderer.compileAsync(scene, camera);
      if (!cancelled) animate();
    })().catch((error) => {
      if (!cancelled) {
        console.warn('NEXUS visual assets failed', error);
        setFailure(true);
        callbacks.current.onError();
      }
    });
    return () => {
      cancelled = true;
      disposeScene();
    };
  }, [inputRef, networkRef, quality]);
  return (
    <div className="race-canvas" ref={host} data-visual-version="after-hours-1">
      {loading < 100 && !failure && (
        <div className="race-asset-loading" role="status">
          <span>MIDNIGHT OUTLAWS</span>
          <strong>{language === 'ru' ? 'Готовим ночной город' : 'Preparing the night city'}</strong>
          <progress value={loading} max="100" />
          <small>{Math.round(loading)}%</small>
        </div>
      )}
      {failure && (
        <div className="race-asset-loading" role="alert">
          <strong>
            {language === 'ru' ? 'Не удалось загрузить сцену' : 'Scene could not be loaded'}
          </strong>
        </div>
      )}
      <div className="race-lens" aria-hidden="true" />
    </div>
  );
}
