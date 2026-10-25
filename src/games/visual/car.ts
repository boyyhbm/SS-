import * as THREE from 'three';
import { batchStaticMeshes } from './geometry';
export const carColors: Record<string, string> = {
  silver: '#bec9d2',
  violet: '#8e76bc',
  cyan: '#498b99',
};
export interface CarVisual {
  group: THREE.Group;
  dispose: () => void;
  update: (
    speed: number,
    steer: number,
    brake: boolean,
    boost: boolean,
    dt: number,
    color?: string,
  ) => void;
}
export function createCar(template: THREE.Object3D, simple = false): CarVisual {
  const group = new THREE.Group(),
    model = template.clone(true);
  group.add(model);
  group.updateMatrixWorld(true);
  const paint: THREE.MeshStandardMaterial[] = [],
    brakes: THREE.MeshStandardMaterial[] = [];
  const unique = new Map<THREE.Material, THREE.Material>();
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = false;
    const original = o.material as THREE.MeshStandardMaterial;
    let m = unique.get(original) as THREE.MeshStandardMaterial | undefined;
    if (!m) {
      m = simple ? new THREE.MeshStandardMaterial().copy(original) : original.clone();
      if (simple) m.normalMap = null;
      unique.set(original, m);
    }
    o.material = m;
    if (/Paint 1|Paint 2/.test(m.name)) {
      m.color.set(carColors.silver);
      m.metalness = 0.62;
      m.roughness = 0.32;
      if (m instanceof THREE.MeshPhysicalMaterial) {
        m.clearcoat = 1;
        m.iridescence = 0;
        m.clearcoatRoughness = 0.22;
      }
      m.normalScale.set(0.025, 0.025);
      m.envMapIntensity = 1.6;
      paint.push(m);
    }
    if (/Glass|Mirror/.test(m.name)) {
      if (m instanceof THREE.MeshPhysicalMaterial) m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.75;
      m.roughness = 0.1;
      m.metalness = 0.5;
      m.envMapIntensity = 1.6;
    }
    if (/Brakelight/.test(m.name)) {
      m.emissive.set('#ff2920');
      m.emissiveIntensity = 0.6;
      brakes.push(m);
    }
    if (/Headlight/.test(m.name)) {
      m.emissive.set('#c3e7ff');
      m.emissiveIntensity = 4;
    }
  });
  const wheels: { steering: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  const wheelGeometry: THREE.BufferGeometry[] = [];
  for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
    const wheel = model.getObjectByName(name);
    if (!wheel) continue;
    const center = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
    const steering = new THREE.Group(),
      spin = new THREE.Group();
    steering.position.copy(center);
    group.add(steering);
    steering.add(spin);
    group.updateMatrixWorld(true);
    spin.attach(wheel);
    if (name.includes('Front')) {
      // Car Concept is authored with 30° of display steering. Neutralize that pose
      // before batching, so wheel roll uses the car's X axle and steering starts at zero.
      const pose = new THREE.Euler().setFromQuaternion(
        wheel.getWorldQuaternion(new THREE.Quaternion()),
        'YXZ',
      );
      wheel.applyMatrix4(new THREE.Matrix4().makeRotationY(-pose.y));
      group.updateMatrixWorld(true);
    }
    for (const pad of [...wheel.children].filter((o) => /BrakePad/.test(o.name)))
      steering.attach(pad);
    wheelGeometry.push(...batchStaticMeshes(spin).geometries);
    wheels.push({ steering, spin, front: name.includes('Front') });
  }
  const { group: body, geometries: ownedGeometry } = batchStaticMeshes(model);
  ownedGeometry.push(...wheelGeometry);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return {
    group,
    dispose() {
      ownedGeometry.forEach((g) => g.dispose());
      unique.forEach((m) => m.dispose());
    },
    update(speed, steer, braking, boost, dt, color = 'silver') {
      for (const p of paint)
        p.color.set(
          p.name.startsWith('Paint 2') ? '#17242b' : (carColors[color] ?? carColors.silver),
        );
      for (const b of brakes) b.emissiveIntensity = braking ? 6 : 1.2;
      for (const w of wheels) {
        w.spin.rotation.x += (speed * dt) / 0.35;
        if (w.front) w.steering.rotation.y = -steer * 0.38;
      }
      body.rotation.z = -steer * Math.min(speed, 40) * 0.0011;
      body.position.y = boost ? Math.sin(performance.now() * 0.04) * 0.007 : 0;
    },
  };
}
