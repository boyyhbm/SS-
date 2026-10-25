'use client';
import { nexusInput } from '../input/manager';
import { FixedStepClock } from './fixed-clock';
import { useEffect, useRef, useState } from 'react';
import type { RaceNetworkDriver } from '../multiplayer/prediction';
import * as THREE from 'three';
import { loadRaceAssets, disposeObjectResources } from './visual/assets';
import { createWorld } from './visual/world';
import { createCar, type CarVisual } from './visual/car';
import { ChaseCameraRig, projectedHeight } from './visual/camera';
import { createCityWorld } from './visual/city-world';
import { initialCityRace, stepCityRace, type CityRaceState } from './city-driving';
import { getCityRoute, type CityRouteId } from './road-network';
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
  routeId?: CityRouteId;
  finished?: boolean;
  checkpointCount?: number;
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
  routeId = 'downtown-circuit',
  freeDrive = false,
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
  routeId?: CityRouteId;
  freeDrive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<RaceState | CityRaceState>({
      ...(networkRef ? initialRace() : initialCityRace(routeId)),
      bestLap: initialBestLap,
    }),
    pausedRef = useRef(paused);
  const quality = useRenderSettings((s) => s.quality);
  const bestRef = useRef(initialBestLap);
  useEffect(() => {
    bestRef.current = initialBestLap;
  }, [initialBestLap]);
  const cityOptions = useRef({ routeId, freeDrive });
  useEffect(() => {
    cityOptions.current = { routeId, freeDrive };
  }, [routeId, freeDrive]);
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
    state.current = {
      ...(networkRef ? initialRace() : initialCityRace(routeId)),
      bestLap: bestRef.current,
    };
  }, [restartKey, routeId, networkRef]);
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
      const cityWorld = networkRef ? undefined : createCityWorld(scene, assets, tier, renderer);
      const world = cityWorld ?? createWorld(scene, assets, tier, renderer);
      const visual = createCar(assets.car.scene, tier === 'low'),
        car = visual.group;
      scene.add(car);
      const carBounds = new THREE.Box3().setFromObject(car);
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
      let renderedRoute = '';
      let previousLap = state.current.lap;
      // A slow presentation frame must not slow the single-player race clock.
      // Catch-up still uses bounded 30 Hz steps and is cleared on pause/visibility loss.
      const clock = new FixedStepClock(1 / 30, networkRef ? 0.25 : 1);
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
          // Opt-in, read-only diagnostics for capture/replay tooling. Observers
          // receive a copy; all movement still goes through normalized input.
          if (container.dataset.instrumentation === 'true')
            window.dispatchEvent(
              new CustomEvent('nexus-simulation-tick', { detail: { ...state.current } }),
            );
          const tickControls = nexusInput.readFresh();
          drivingInput = {
            throttle: Math.max(inputRef.current.throttle, tickControls.accelerate),
            brake: Math.max(inputRef.current.brake, tickControls.brake),
            steer: inputRef.current.steer || tickControls.steer,
            nitro: inputRef.current.nitro || tickControls.boost > 0.5,
            handbrake: !!inputRef.current.handbrake || tickControls.handbrake > 0.5,
          };
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
            const lap =
              'routeId' in race
                ? stepCityRace(race, drivingInput, dt, cityOptions.current.freeDrive)
                : stepRace(race, drivingInput, dt);
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
          callbacks.current.onTelemetry({
            ...state.current,
            ...('routeId' in state.current
              ? { checkpointCount: getCityRoute(state.current.routeId).gates.length }
              : {}),
          });
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
      const cameraRig = new ChaseCameraRig(camera);
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
        let sceneKey = `${presentation.current}:${pausedRef.current}:${cityOptions.current.routeId}`;
        if (renderedRoute !== cityOptions.current.routeId) {
          cameraRig.reset();
          renderedRoute = cityOptions.current.routeId;
        }
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
        car.rotation.z = 0;
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
        cityWorld?.setRoute(
          cityOptions.current.routeId,
          race.nextCheckpoint,
          cityOptions.current.freeDrive,
        );
        container.dataset.boosting = String(boost);
        renderer.domElement.dataset.route = network
          ? 'legacy-circuit'
          : cityOptions.current.routeId;
        container.dataset.braking = String(braking);
        const reduced =
          useUI.getState().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        cameraRig.update(
          race,
          pausedRef.current ? 0 : dt,
          cameraMode,
          useRenderSettings.getState().dynamicFov,
          reduced,
          cityWorld?.clipCamera,
        );
        renderer.domElement.dataset.cameraMode = String(cameraMode);
        renderer.domElement.dataset.cameraSettled = 'true';
        renderer.domElement.dataset.cameraDistance = String(
          Math.hypot(camera.position.x - race.x, camera.position.z - race.z),
        );
        renderer.domElement.dataset.cameraFov = String(camera.fov);
        car.updateMatrixWorld(true);
        renderer.domElement.dataset.projectedCarHeight = String(
          projectedHeight(camera, carBounds, car.matrixWorld),
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
          callbacks.current.onTelemetry({
            ...state.current,
            ...('routeId' in state.current
              ? { checkpointCount: getCityRoute(state.current.routeId).gates.length }
              : {}),
          });
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
    <div className="race-canvas" ref={host} data-visual-version="city-streets-2">
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
