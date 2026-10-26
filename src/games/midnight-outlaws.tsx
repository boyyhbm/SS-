'use client';
import { nexusInput } from '../input/manager';
import { FixedStepClock } from './fixed-clock';
import { RacePresentation } from './presentation';
import { createRacingLine } from './visual/racing-line';
import { useRacingPreferences } from './racing-preferences';
import { useEffect, useRef, useState } from 'react';
import type { RaceNetworkDriver } from '../multiplayer/prediction';
import * as THREE from 'three';
import { loadRaceAssets, disposeRaceAssets } from './visual/assets';
import { calibrateGraphics } from './visual/calibration';
import { createLocalReflections } from './visual/reflections';
import { createWorld } from './visual/world';
import { createCar, createRemoteCar, type CarVisual } from './visual/car';
import { ChaseCameraRig, projectedHeight } from './visual/camera';
import { createCityWorld } from './visual/city-world';
import { initialCityRace, stepCityRace, type CityRaceState } from './city-driving';
import { getCityRoute } from './road-network';
import { isCityRoute, type RouteId } from './route-registry';
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
  routeId?: RouteId;
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
  routeId = networkRef ? 'legacy-circuit' : 'downtown-circuit',
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
  routeId?: RouteId;
  freeDrive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<RaceState | CityRaceState>({
      ...(isCityRoute(routeId) ? initialCityRace(routeId) : initialRace()),
      bestLap: initialBestLap,
    }),
    pausedRef = useRef(paused);
  const quality = useRenderSettings((s) => s.quality);
  const cityScene = isCityRoute(routeId);
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
      ...(isCityRoute(routeId) ? initialCityRace(routeId) : initialRace()),
      bestLap: bestRef.current,
    };
  }, [restartKey, routeId, networkRef]);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    void useRacingPreferences.getState().load();
    let cancelled = false,
      disposeScene = () => {};
    setLoading(0);
    setFailure(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch {
      callbacks.current.onError();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'MIDNIGHT OUTLAWS WebGL game');
    renderer.domElement.tabIndex = 0;

    container.appendChild(renderer.domElement);
    disposeScene = () => {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    void (async () => {
      const tier: RenderTier =
        quality === 'auto'
          ? await calibrateGraphics(
              renderer,
              cityScene,
              (n) => {
                if (!cancelled) setLoading(n * 0.5);
              },
              () => cancelled,
            )
          : quality;
      if (cancelled) return;
      const preset = qualityPresets[tier];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr));
      renderer.shadowMap.enabled = preset.shadows;
      renderer.domElement.dataset.quality = tier;
      const assets = await loadRaceAssets(
        tier,
        (v) => {
          if (!cancelled)
            setLoading(
              Math.min(85, (quality === 'auto' ? 28 : 0) + v * (quality === 'auto' ? 0.55 : 0.8)),
            );
        },
        renderer,
      );
      renderer.domElement.dataset.assetFormat = assets.assetFormat;
      if (cancelled) {
        disposeRaceAssets(assets);
        return;
      }
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        58,
        container.clientWidth / container.clientHeight,
        0.15,
        preset.cityDistance,
      );
      camera.layers.enable(1);
      camera.layers.enable(2);
      const cityWorld = cityScene ? createCityWorld(scene, assets, tier, renderer) : undefined;
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
      const assist = createRacingLine(scene);
      const remoteCars = new Map<string, CarVisual>();
      // Pre-create the bounded remote actor pool while loading. Only real server
      // player IDs can make these actors visible; no fake online participants.
      const pool = Array.from({ length: 5 }, () =>
        createRemoteCar(assets.car.scene, assets.carLow.scene, tier === 'low'),
      );
      for (const actor of pool) {
        scene.add(actor.group);
        actor.group.visible = false;
      }
      const allActors = [visual, ...pool];
      let reflections: Awaited<ReturnType<typeof createLocalReflections>> = null;
      let bootstrapDisposed = false;
      const disposeBootstrap = () => {
        if (bootstrapDisposed) return;
        bootstrapDisposed = true;
        reflections?.dispose();
        assist.dispose();
        world.dispose();
        pipeline.dispose();
        allActors.forEach((actor) => actor.dispose());
        disposeRaceAssets(assets, scene);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      disposeScene = disposeBootstrap;
      try {
        reflections = cityWorld
          ? await createLocalReflections(
              renderer,
              scene,
              tier,
              (x, z) => {
                if (cancelled) throw new Error('Scene loading cancelled');
                cityWorld.prepareCapture();
                world.update({ ...state.current, x, z }, false, 0, false);
              },
              (n) => {
                if (!cancelled) setLoading(85 + n * 10);
              },
            )
          : null;
      } catch (error) {
        disposeBootstrap();
        throw error;
      }
      if (cancelled) {
        reflections?.dispose();
        return;
      }
      cityWorld?.prepareCapture();
      world.update(state.current, false, 0, false);
      const actorProbes = new Map(allActors.map((v) => [v, reflections?.bind(v.materials)]));
      const roadProbe = cityWorld && reflections?.bind(cityWorld.reflectionMaterials);
      renderer.domElement.dataset.reflectionProbes = String(reflections?.count ?? 0);
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
      let previousTick = performance.now();
      const poses = new RacePresentation(state.current);
      let stateIdentity = state.current;
      let physicsMs = 0,
        physicsSteps = 0;
      const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
      let drivingInput: RaceInput = { throttle: 0, brake: 0, steer: 0, nitro: false };
      function simulate(now = performance.now()) {
        const elapsed = (now - previousTick) / 1000;
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
          if (stateIdentity !== state.current) {
            poses.reset(state.current);
            stateIdentity = state.current;
          }
          const stepStarted = performance.now();
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
          physicsMs += performance.now() - stepStarted;
          physicsSteps++;
          poses.push(race);
          if (race.lap > previousLap) void nexusInput.haptic('finish');
          previousLap = race.lap;
          if (!pausedRef.current) {
            if (race.collision) void nexusInput.haptic('collision');
            else if (drivingInput.nitro && drivingInput.throttle > 0 && race.nitro > 0)
              void nexusInput.haptic('boost');
            else if (drivingInput.throttle > 0.2) void nexusInput.haptic('accelerate');
          }
        });
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
        // Drain elapsed physics before sampling presentation. The independent
        // network/input timer uses the SAME clock and timestamp, so it cannot
        // double-step. It keeps sending while a slow GPU delays visible frames.
        const now = performance.now();
        simulate(now);
        const dt = Math.min(Math.max(0, (now - previousFrame) / 1000), 0.25);
        if (stateIdentity !== state.current) {
          poses.reset(state.current);
          stateIdentity = state.current;
        }
        const alpha = clock.remainder / clock.step;
        const race = poses.sample(alpha, pausedRef.current);
        previousFrame = now;
        const input = drivingInput;
        const network = networkRef?.current;
        let sceneKey = `${presentation.current}:${pausedRef.current}:${cityOptions.current.routeId}:${useRacingPreferences.getState().mode}:${useRenderSettings.getState().dynamicFov}`;
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
              ghost = pool.find((actor) => ![...remoteCars.values()].includes(actor));
              if (!ghost) continue;
              remoteCars.set(peer.id, ghost);
            }
            ghost.group.position.set(peer.state.x, 0.025, peer.state.z);
            ghost.group.rotation.y = peer.state.heading;
            ghost.group.visible = peer.connected || peer.finish !== null;
            const peerBrake =
              'brakePressure' in peer.state && Number(peer.state.brakePressure) > 0.1;
            const peerBoost =
              typeof ghost.group.userData.nitro === 'number' &&
              peer.state.nitro < ghost.group.userData.nitro;
            ghost.group.userData.nitro = peer.state.nitro;
            ghost.distance?.(Math.hypot(peer.state.x - race.x, peer.state.z - race.z));
            actorProbes.get(ghost)?.update(peer.state.x, peer.state.z, dt);
            ghost.update(
              peer.state.speed,
              peer.state.steering,
              peerBrake,
              peerBoost,
              pausedRef.current ? 0 : dt,
              peer.car,
            );
          }
          for (const [id, ghost] of remoteCars)
            if (!peers.some((p) => p.id === id)) {
              ghost.group.visible = false;
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
        actorProbes.get(visual)?.update(race.x, race.z, dt);
        roadProbe?.update(race.x, race.z, dt);
        world.update(race, braking, dt, boost);
        const lineStats = assist.update(
          cityOptions.current.routeId,
          race,
          cityOptions.current.freeDrive ? 'off' : useRacingPreferences.getState().mode,
        );
        renderer.domElement.dataset.racingLineRed = String(lineStats.red);
        renderer.domElement.dataset.racingLineYellow = String(lineStats.yellow);
        renderer.domElement.dataset.racingLineGreen = String(lineStats.green);
        renderer.domElement.dataset.racingLine = cityOptions.current.freeDrive
          ? 'off'
          : useRacingPreferences.getState().mode;
        if (isCityRoute(cityOptions.current.routeId))
          cityWorld?.setRoute(
            cityOptions.current.routeId,
            race.nextCheckpoint,
            cityOptions.current.freeDrive,
          );
        container.dataset.boosting = String(boost);
        renderer.domElement.dataset.route = cityOptions.current.routeId;
        container.dataset.braking = String(braking);
        const reduced = useUI.getState().reducedMotion || reducedQuery.matches;
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
        if (container.dataset.instrumentation === 'true') {
          car.updateMatrixWorld(true);
          renderer.domElement.dataset.projectedCarHeight = String(
            projectedHeight(camera, carBounds, car.matrixWorld),
          );
          window.dispatchEvent(
            new CustomEvent('nexus-presentation-frame', {
              detail: {
                now,
                alpha,
                x: race.x,
                z: race.z,
                heading: race.heading,
                steering: race.steering,
                cameraX: camera.position.x,
                cameraZ: camera.position.z,
                cameraHeading: camera.rotation.y,
              },
            }),
          );
        }
        renderer.domElement.dataset.throttle = String(input.throttle);
        renderer.domElement.dataset.brake = String(input.brake);
        renderer.domElement.dataset.steer = String(input.steer);
        renderer.domElement.dataset.handbrake = String(!!input.handbrake);
        renderer.domElement.dataset.remoteCars = String(remoteCars.size);
        // A single-player pause freezes the world and releases the GPU for console navigation.
        // Idle lobbies redraw when their presentation changes. Network simulation keeps ticking.
        if (sceneKey !== renderedPresentation) renderDirty = true;
        if (!ready || !pausedRef.current || renderDirty) {
          pipeline.render(pausedRef.current, {
            mainThreadStartedAt: now,
            physicsMs,
            physicsSteps,
            alpha,
            networkDelayMs: network ? 120 : 0,
            snapshotAgeMs: network?.snapshotAgeMs?.() ?? 0,
          });
          physicsMs = 0;
          physicsSteps = 0;
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
        disposeBootstrap();
      };
      // Compile every pooled actor before hiding it; a joining player must not
      // create GPU buffers or compile a new car shader during a fast corner.
      car.position.set(state.current.x, 0.03, state.current.z);
      car.rotation.y = state.current.heading;
      cameraRig.update(state.current, 0, 0, false, true, cityWorld?.clipCamera);
      pool.forEach((actor, i) => {
        actor.group.position.set(
          state.current.x + (i % 2 ? 3 : -3),
          0.03,
          state.current.z + Math.floor(i / 2) * 6,
        );
        actor.group.visible = true;
        actor.prewarm?.(true);
      });
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      pool.forEach((actor) => {
        actor.prewarm?.(false);
        actor.group.visible = false;
      });
      if (!cancelled) animate();
    })().catch((error) => {
      if (!cancelled) {
        disposeScene();
        console.warn('NEXUS visual assets failed', error);
        setFailure(true);
        callbacks.current.onError();
      }
    });
    return () => {
      cancelled = true;
      disposeScene();
    };
  }, [inputRef, networkRef, quality, cityScene]);
  return (
    <div className="race-canvas" ref={host} data-visual-version="city-radiance-3">
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
