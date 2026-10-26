'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCar, type CarVisual } from '@/games/visual/car';
import { disposeObjectResources } from '@/games/visual/assets';
import { getVehicle, type VehicleId } from '@/games/vehicles/config';
import { nexusInput } from '@/input/manager';
export default function GarageViewer({
  vehicleId,
  paint,
  orbit,
  language,
}: {
  vehicleId: VehicleId;
  paint: string;
  orbit: number;
  language: 'ru' | 'en';
}) {
  const host = useRef<HTMLDivElement>(null),
    params = useRef({ paint, orbit });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    params.current = { paint, orbit };
  }, [paint, orbit]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let closed = false,
      frame = 0,
      visual: CarVisual | undefined,
      source: THREE.Object3D | undefined;
    setStatus('loading');
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.dataset.garageVehicle = vehicleId;
    renderer.domElement.setAttribute('aria-label', getVehicle(vehicleId).displayName + ' — 3D');
    container.append(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(37, 1, 0.1, 60);
    camera.layers.enableAll();
    const room = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(renderer),
      environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.48;
    room.dispose();
    pmrem.dispose();
    const floorGeometry = new THREE.CircleGeometry(9, 96),
      floorMaterial = new THREE.MeshStandardMaterial({
        color: '#0c161b',
        roughness: 0.8,
        metalness: 0.08,
      });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -0.015;
    scene.add(floor);
    scene.add(new THREE.HemisphereLight('#dfeeff', '#303c42', 1.2));
    for (const [x, z, color, power] of [
      [-4, -2, '#c5e3ff', 90],
      [3, 4, '#ffe5cb', 110],
      [0, -5, '#b4d8ce', 80],
    ] as const) {
      const light = new THREE.SpotLight(color, power, 25, 0.6, 0.75, 1.6);
      light.position.set(x, 6, z);
      light.target.position.set(0, 0.5, 0);
      if (x === -4) {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.00015;
        light.shadow.normalBias = 0.025;
      }
      scene.add(light, light.target);
    }
    const resize = () => {
      const w = container.clientWidth,
        h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let yaw = -2.3,
      pitch = 0.18,
      drag = false,
      oldX = 0,
      oldY = 0,
      lastTime = performance.now(),
      lastOrbit = params.current.orbit;
    const pointerDown = (e: PointerEvent) => {
      drag = true;
      oldX = e.clientX;
      oldY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const pointerMove = (e: PointerEvent) => {
      if (!drag) return;
      yaw -= (e.clientX - oldX) * 0.007;
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - oldY) * 0.004, 0.02, 0.7);
      oldX = e.clientX;
      oldY = e.clientY;
    };
    const pointerUp = () => {
      drag = false;
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),
      config = getVehicle(vehicleId);
    loader
      .loadAsync(config.modelAsset === 'concept' ? '/game-assets/car-high.glb' : config.modelAsset)
      .then(async (gltf) => {
        if (closed) {
          disposeObjectResources(gltf.scene);
          return;
        }
        source = gltf.scene;
        visual = createCar(source);
        scene.add(visual.group);
        visual.update(0, 0, false, false, 0, params.current.paint);
        await renderer.compileAsync(scene, camera);
        if (!closed) {
          renderer.domElement.dataset.garageReady = 'true';
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!closed) setStatus('error');
      });
    function draw(now: number) {
      if (closed) return;
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      yaw += (params.current.orbit - lastOrbit) * 0.38;
      lastOrbit = params.current.orbit;
      const input = nexusInput.read();
      yaw -= input.lookX * dt * 1.5;
      pitch = THREE.MathUtils.clamp(pitch + input.lookY * dt * 0.6, 0.02, 0.7);
      const radius = 7.8;
      camera.position.set(
        Math.sin(yaw) * radius * Math.cos(pitch),
        1.05 + Math.sin(pitch) * radius,
        Math.cos(yaw) * radius * Math.cos(pitch),
      );
      camera.lookAt(0, 0.75, 0);
      visual?.update(0, 0, false, false, 0, params.current.paint);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      visual?.dispose();
      if (source) disposeObjectResources(source);
      scene.traverse((o) => {
        if (o instanceof THREE.Light) o.dispose();
      });
      floorGeometry.dispose();
      floorMaterial.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [vehicleId]);
  return (
    <div className="garage-viewer" ref={host} data-testid="garage-viewer">
      {status !== 'ready' && (
        <span role="status">
          {status === 'error'
            ? language === 'ru'
              ? 'Не удалось загрузить автомобиль'
              : 'Could not load vehicle'
            : language === 'ru'
              ? 'Загрузка автомобиля…'
              : 'Loading vehicle…'}
        </span>
      )}
    </div>
  );
}
