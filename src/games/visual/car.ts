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
      m.metalness = 0.64;
      m.roughness = 0.27;
      if (m instanceof THREE.MeshPhysicalMaterial) {
        m.clearcoat = 1;
        m.iridescence = 0;
        m.clearcoatRoughness = 0.16;
      }
      m.normalScale.set(0.025, 0.025);
      m.envMapIntensity = 1.15;
      paint.push(m);
    }
    if (/Glass|Mirror/.test(m.name)) {
      if (/Glass/.test(m.name)) m.color.set('#637a86');
      if (m instanceof THREE.MeshPhysicalMaterial) m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.86;
      m.roughness = 0.13;
      m.metalness = 0.06;
      m.envMapIntensity = 1.25;
    }
    if (/Brakelight/.test(m.name)) {
      m.emissive.set('#ff2920');
      m.emissiveIntensity = 0.6;
      brakes.push(m);
    }
    if (/Headlight/.test(m.name)) {
      m.emissive.set('#c3e7ff');
      m.emissiveIntensity = 2.4;
    }
  });
  const wheels: { steering: THREE.Group; spin: THREE.Group; front: boolean; radius: number }[] = [];
  const wheelGeometry: THREE.BufferGeometry[] = [];
  for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
    const wheel = model.getObjectByName(name);
    if (!wheel) continue;
    const center = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
    const steering = new THREE.Group(),
      spin = new THREE.Group();
    steering.name = `WheelRig_${name}`;
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
    const wheelBox = new THREE.Box3().setFromObject(steering);
    wheels.push({
      steering,
      spin,
      front: name.includes('Front'),
      radius: Math.max(0.15, (wheelBox.max.y - wheelBox.min.y) / 2),
    });
  }
  const { group: body, geometries: ownedGeometry } = batchStaticMeshes(model);
  ownedGeometry.push(...wheelGeometry);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const ground = new THREE.Box3().setFromObject(group).min.y;
  if (Number.isFinite(ground)) for (const child of group.children) child.position.y -= ground;
  const contactGeometry = new THREE.PlaneGeometry(2.5, 4.9);
  const contactMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader:
      'varying vec2 uvContact;void main(){uvContact=uv;vec4 p=vec4(position,1.0);\n#ifdef USE_INSTANCING\np=instanceMatrix*p;\n#endif\ngl_Position=projectionMatrix*modelViewMatrix*p;}',
    fragmentShader:
      'varying vec2 uvContact;void main(){vec2 p=abs(uvContact-0.5)*2.0;float a=(1.0-smoothstep(0.32,1.0,p.x))*(1.0-smoothstep(0.55,1.0,p.y));gl_FragColor=vec4(0.015,0.021,0.025,a*0.48);}',
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const contact = new THREE.Mesh(contactGeometry, contactMaterial);
  contact.name = 'Tire_contact_shadow';
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.001;
  contact.renderOrder = 1;
  group.add(contact);
  return {
    group,
    dispose() {
      ownedGeometry.forEach((g) => g.dispose());
      unique.forEach((m) => m.dispose());
      contactGeometry.dispose();
      contactMaterial.dispose();
    },
    update(speed, steer, braking, boost, dt, color = 'silver') {
      for (const p of paint)
        p.color.set(
          p.name.startsWith('Paint 2') ? '#17242b' : (carColors[color] ?? carColors.silver),
        );
      for (const b of brakes) b.emissiveIntensity = braking ? 4 : 0.8;
      for (const w of wheels) {
        w.spin.rotation.x += (speed * dt) / w.radius;
        if (w.front) w.steering.rotation.y = -steer * 0.38;
      }
      body.rotation.z = -steer * Math.min(Math.abs(speed), 40) * 0.00065;
      body.rotation.x +=
        ((braking ? 0.012 : boost ? -0.008 : 0) - body.rotation.x) * (1 - Math.exp(-dt * 7));
    },
  };
}
