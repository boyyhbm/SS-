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
import { stepCityRace, type CityRaceState } from './city-driving';
import { isCityRoute, getRoute, type RouteId } from './route-registry';
import { isTrackId, getTrack } from './tracks/registry';
import { stepTrackRace, type TrackRaceState } from './tracks/physics';
import { projectRoad, sampleRoadDistance } from './tracks/geometry';
import { createTrackWorld } from './visual/track-world';
import { qualityPresets, useRenderSettings, type RenderTier } from './visual/quality';
import { createRenderPipeline } from './visual/pipeline';
import { useUI } from '../lib/ui-store';
import { stepRace, type RaceInput, type RaceState } from './racing-physics';
import { GameAudioEngine, type GameAudioStatus } from './audio/engine';
import { audioText } from './audio/config';
import { useGameAudioSettings } from './audio/settings';
import { initialPlayableState } from './initial-state';
import { DEFAULT_VEHICLE, getVehicle, vehicles, type VehicleId } from './vehicles/config';
export interface RaceTelemetry {
  vehicleId?: VehicleId;
  gear?: number;
  rpm?: number;
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
  onLoading,
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
  vehicleId,
  paint = 'silver',
  laps,
}: {
  language: 'ru' | 'en';
  presentationKey?: string;
  paused: boolean;
  onReady: () => void;
  onLoading?: () => void;
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
  vehicleId?: VehicleId;
  paint?: string;
  laps?: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    audio = useRef<GameAudioEngine | null>(null),
    state = useRef<RaceState | CityRaceState | TrackRaceState>({
      ...initialPlayableState(routeId, vehicleId),
      bestLap: initialBestLap,
    }),
    pausedRef = useRef(paused);
  const quality = useRenderSettings((s) => s.quality);
  const cityScene = isCityRoute(routeId);
  const trackScene = isTrackId(routeId) ? routeId : undefined;
  const bestRef = useRef(initialBestLap);
  const [audioStatus, setAudioStatus] = useState<GameAudioStatus>('locked');
  useEffect(() => {
    const engine = new GameAudioEngine((status) => {
      setAudioStatus(status);
      window.dispatchEvent(new CustomEvent('nexus-game-audio-status', { detail: status }));
    });
    audio.current = engine;
    engine.setSettings(useGameAudioSettings.getState().settings);
    const unsubscribe = useGameAudioSettings.subscribe((s) => engine.setSettings(s.settings));
    void useGameAudioSettings.getState().load();
    const unlock = () => void engine.resume();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    let confirmed = false;
    const pad = nexusInput.on((event) => {
      if (event.type !== 'frame') return;
      const down = event.values.confirm > 0.5;
      if (down && !confirmed && engine.status !== 'running') unlock();
      confirmed = down;
    });
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      pad();
      unsubscribe();
      void useGameAudioSettings.getState().flush();
      engine.dispose();
      if (audio.current === engine) audio.current = null;
    };
  }, []);
  useEffect(() => {
    bestRef.current = initialBestLap;
  }, [initialBestLap]);
  const cityOptions = useRef({ routeId, freeDrive, laps });
  const vehicleOptions = useRef({ vehicleId, paint });
  useEffect(() => {
    vehicleOptions.current = { vehicleId, paint };
  }, [vehicleId, paint]);
  useEffect(() => {
    cityOptions.current = { routeId, freeDrive, laps };
  }, [routeId, freeDrive, laps]);
  const [loading, setLoading] = useState(0),
    [failure, setFailure] = useState(false);
  const callbacks = useRef({ onReady, onLoading, onError, onLap, onTelemetry, onPause });
  const presentation = useRef(presentationKey);
  useEffect(() => {
    presentation.current = presentationKey;
  }, [presentationKey]);
  useEffect(() => {
    callbacks.current = { onReady, onLoading, onError, onLap, onTelemetry, onPause };
  }, [onReady, onLoading, onError, onLap, onTelemetry, onPause]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    state.current = {
      ...initialPlayableState(routeId, vehicleId),
      bestLap: bestRef.current,
    };
  }, [restartKey, routeId, networkRef, vehicleId]);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    callbacks.current.onLoading?.();
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
              trackScene,
            )
          : quality;
      if (cancelled) return;
      const preset = qualityPresets[tier];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr));
      renderer.shadowMap.enabled = preset.shadows;
      renderer.domElement.dataset.quality = tier;
      renderer.domElement.dataset.track =
        trackScene ?? (cityScene ? 'nexus-city' : 'legacy-circuit');
      const assets = await loadRaceAssets(
        tier,
        (v) => {
          if (!cancelled)
            setLoading(
              Math.min(85, (quality === 'auto' ? 28 : 0) + v * (quality === 'auto' ? 0.55 : 0.8)),
            );
        },
        renderer,
        true,
        trackScene,
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
      const trackWorld = trackScene
        ? createTrackWorld(scene, assets, tier, renderer, trackScene)
        : undefined;
      const world = cityWorld ?? trackWorld ?? createWorld(scene, assets, tier, renderer);
      const localVisuals = new Map(
        vehicles.map((v) => [
          v.vehicleId,
          createCar(assets.vehicles[v.vehicleId].scene, tier === 'low', v.steeringLimit),
        ]),
      );
      for (const actor of localVisuals.values()) {
        scene.add(actor.group);
        actor.group.visible = false;
      }
      let visual = localVisuals.get(vehicleOptions.current.vehicleId ?? DEFAULT_VEHICLE)!,
        car = visual.group;
      car.visible = true;
      const bounds = new Map(
        [...localVisuals].map(([id, actor]) => [id, new THREE.Box3().setFromObject(actor.group)]),
      );
      const carBounds = bounds.get(vehicleOptions.current.vehicleId ?? DEFAULT_VEHICLE)!.clone();
      const modelTriangles = new Map(
        vehicles.map((v) => {
          let triangles = 0;
          assets.vehicles[v.vehicleId].scene.traverse((o) => {
            if (o instanceof THREE.Mesh)
              triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
          });
          return [v.vehicleId, triangles] as const;
        }),
      );
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
      const pool = vehicles.flatMap((v) =>
        Array.from({ length: 5 }, () => {
          const model = assets.vehicles[v.vehicleId].scene;
          const actor = createRemoteCar(
            model,
            v.modelAsset === 'concept' ? assets.carLow.scene : model,
            tier === 'low',
            v.steeringLimit,
          );
          actor.group.userData.vehicleId = v.vehicleId;
          return actor;
        }),
      );
      for (const actor of pool) {
        scene.add(actor.group);
        actor.group.visible = false;
      }
      const allActors = [...localVisuals.values(), ...pool];
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
        reflections =
          cityWorld || trackWorld
            ? await createLocalReflections(
                renderer,
                scene,
                tier,
                (x, z) => {
                  if (cancelled) throw new Error('Scene loading cancelled');
                  cityWorld?.prepareCapture();
                  trackWorld?.prepareCapture();
                  world.update(
                    {
                      ...state.current,
                      x,
                      z,
                      y: trackScene
                        ? projectRoad(getTrack(trackScene).roadGeometry, x, z).height
                        : 0,
                    },
                    false,
                    0,
                    false,
                  );
                },
                (n) => {
                  if (!cancelled) setLoading(85 + n * 10);
                },
                trackScene
                  ? Array.from({ length: tier === 'high' ? 3 : 5 }, (_, i) => {
                      const p = sampleRoadDistance(
                        getTrack(trackScene).roadGeometry,
                        (i * getTrack(trackScene).length) / (tier === 'high' ? 3 : 5),
                      );
                      return [p.x, p.z, p.y + 1.5];
                    })
                  : undefined,
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
      const roadProbe =
        (cityWorld || trackWorld) &&
        reflections?.bind((cityWorld ?? trackWorld)!.reflectionMaterials);
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
        audio.current?.setPaused(pausedRef.current || document.hidden);
        audio.current?.setEnvironment(
          isTrackId(cityOptions.current.routeId)
            ? getTrack(cityOptions.current.routeId).environment
            : cityOptions.current.routeId === 'industrial-run'
              ? 'industrial'
              : 'city',
        );
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
                ? isTrackId(race.routeId)
                  ? stepTrackRace(
                      race as TrackRaceState,
                      drivingInput,
                      dt,
                      cityOptions.current.freeDrive,
                      cityOptions.current.laps,
                    )
                  : stepCityRace(
                      race as CityRaceState,
                      drivingInput,
                      dt,
                      cityOptions.current.freeDrive,
                      cityOptions.current.laps,
                    )
                : stepRace(race, drivingInput, dt);
            if (lap !== null) callbacks.current.onLap(lap);
          }
          physicsMs += performance.now() - stepStarted;
          physicsSteps++;
          poses.push(race);
          if (race.vehicleId) audio.current?.setProfile(getVehicle(race.vehicleId).audioProfile);
          audio.current?.update(race, drivingInput, dt);
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
              ? { checkpointCount: getRoute(state.current.routeId).gates.length }
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
        const wantedVehicle =
          network?.vehicle?.() ?? vehicleOptions.current.vehicleId ?? DEFAULT_VEHICLE;
        const wantedVisual = localVisuals.get(wantedVehicle)!;
        renderer.domElement.dataset.vehicle = wantedVehicle;
        renderer.domElement.dataset.modelTriangles = String(modelTriangles.get(wantedVehicle));
        if (wantedVisual !== visual) {
          visual.group.visible = false;
          visual = wantedVisual;
          car = visual.group;
          car.visible = true;
          carBounds.copy(bounds.get(wantedVehicle)!);
          renderDirty = true;
        }
        let sceneKey = `${presentation.current}:${pausedRef.current}:${cityOptions.current.routeId}:${useRacingPreferences.getState().mode}:${useRenderSettings.getState().dynamicFov}:${wantedVehicle}:${vehicleOptions.current.paint}`;
        if (renderedRoute !== cityOptions.current.routeId) {
          cameraRig.reset();
          renderedRoute = cityOptions.current.routeId;
        }
        if (network) {
          sceneKey += `:${network.car()}`;
          const peers = network.remotePlayers();
          audio.current?.updateOpponents(peers, dt);
          for (const peer of peers) {
            sceneKey += `:${peer.id}:${peer.car}:${peer.connected}:${peer.finish}`;
            let ghost = remoteCars.get(peer.id);
            const peerVehicle = peer.vehicleId ?? DEFAULT_VEHICLE;
            if (ghost && ghost.group.userData.vehicleId !== peerVehicle) {
              ghost.group.visible = false;
              remoteCars.delete(peer.id);
              ghost = undefined;
            }
            if (!ghost) {
              ghost = pool.find(
                (actor) =>
                  actor.group.userData.vehicleId === peerVehicle &&
                  ![...remoteCars.values()].includes(actor),
              );
              if (!ghost) continue;
              remoteCars.set(peer.id, ghost);
            }
            const peerY = trackScene
              ? projectRoad(getTrack(trackScene).roadGeometry, peer.state.x, peer.state.z).height
              : (peer.state.y ?? 0);
            ghost.group.position.set(peer.state.x, peerY + 0.025, peer.state.z);
            ghost.group.rotation.order = 'YXZ';
            ghost.group.rotation.x = -(peer.state.roadPitch ?? 0);
            ghost.group.rotation.z = peer.state.roadBank ?? 0;
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
              peer.state.vehicleId
                ? { pitch: peer.state.bodyPitch ?? 0, roll: peer.state.bodyRoll ?? 0 }
                : undefined,
            );
          }
          for (const [id, ghost] of remoteCars)
            if (!peers.some((p) => p.id === id)) {
              ghost.group.visible = false;
              remoteCars.delete(id);
            }
        }
        car.position.set(race.x, (race.y ?? 0) + 0.03, race.z);
        car.rotation.order = 'YXZ';
        car.rotation.x = -(race.roadPitch ?? 0);
        car.rotation.y = race.heading;
        car.rotation.z = race.roadBank ?? 0;
        const boost = !pausedRef.current && input.nitro && race.nitro > 0 && race.speed > 4;
        const braking = !pausedRef.current && (input.brake > 0.1 || !!input.handbrake);
        visual.update(
          race.speed,
          race.steering,
          braking,
          boost,
          pausedRef.current ? 0 : dt,
          network?.car() ?? vehicleOptions.current.paint,
          race.vehicleId ? { pitch: race.bodyPitch ?? 0, roll: race.bodyRoll ?? 0 } : undefined,
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
          cityWorld?.clipCamera ?? trackWorld?.clipCamera,
        );
        audio.current?.setListener(
          camera.position.x,
          camera.position.y,
          camera.position.z,
          race.heading,
          cameraMode,
        );
        renderer.domElement.dataset.cameraMode = String(cameraMode);
        renderer.domElement.dataset.cameraSettled = 'true';
        renderer.domElement.dataset.cameraDistance = String(
          Math.hypot(camera.position.x - race.x, camera.position.z - race.z),
        );
        renderer.domElement.dataset.cameraFov = String(camera.fov);
        if (container.dataset.instrumentation === 'true') {
          window.dispatchEvent(
            new CustomEvent('nexus-game-audio-telemetry', { detail: audio.current?.inspect() }),
          );
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
              ? { checkpointCount: getRoute(state.current.routeId).gates.length }
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
      car.position.set(state.current.x, (state.current.y ?? 0) + 0.03, state.current.z);
      car.rotation.y = state.current.heading;
      cameraRig.update(
        state.current,
        0,
        0,
        false,
        true,
        cityWorld?.clipCamera ?? trackWorld?.clipCamera,
      );
      const warmingActors = allActors.filter((actor) => actor !== visual);
      warmingActors.forEach((actor, i) => {
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
      warmingActors.forEach((actor) => {
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
  }, [inputRef, networkRef, quality, cityScene, trackScene]);
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
      {!paused && loading === 100 && audioStatus !== 'running' && (
        <div className="game-audio-unlock" role="status">
          <span>
            {audioStatus === 'unavailable'
              ? audioText[language].unavailable
              : audioText[language].locked}
          </span>
          {audioStatus !== 'unavailable' && (
            <button
              type="button"
              className="text-button"
              onClick={() => void audio.current?.resume()}
            >
              {audioText[language].enable}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
