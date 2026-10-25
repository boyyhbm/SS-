import { expect, it } from 'vitest';
import * as THREE from 'three';
import { batchStaticMeshes } from '../src/games/visual/geometry';
import { createCar } from '../src/games/visual/car';

it('batching preserves world-space GLB vertices under nested transforms and normalized accessors', () => {
  const root = new THREE.Group();
  root.position.set(4, 2, -3);
  root.rotation.y = 0.7;
  root.scale.set(2, 1, 3);
  const material = new THREE.MeshStandardMaterial();
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    'position',
    new THREE.Int16BufferAttribute([32767, 0, 0, 0, 32767, 0, 0, 0, 32767], 3, true),
  );
  source.setIndex([0, 1, 2]);
  for (const offset of [-2, 3]) {
    const parent = new THREE.Group();
    parent.position.set(offset, 1, 0);
    parent.rotation.z = offset * 0.1;
    parent.add(new THREE.Mesh(source, material));
    root.add(parent);
  }
  function vertices() {
    root.updateMatrixWorld(true);
    const points: THREE.Vector3[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++)
        points.push(
          new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld),
        );
    });
    return points.sort((a, b) => a.x - b.x);
  }
  const before = vertices();
  const batch = batchStaticMeshes(root);
  const after = vertices();
  expect(batch.group.children).toHaveLength(1);
  expect(after).toHaveLength(before.length);
  after.forEach((point, index) => expect(point.distanceTo(before[index])).toBeLessThan(0.00002));
  expect(source.getAttribute('position').normalized).toBe(true);
  expect(source.getAttribute('position').array).toBeInstanceOf(Int16Array);
  batch.geometries.forEach((geometry) => geometry.dispose());
  source.dispose();
  material.dispose();
});

it('neutralizes the source car display steering before applying game input', () => {
  const template = new THREE.Group(),
    wheel = new THREE.Group();
  wheel.name = 'WheelFrontL';
  wheel.position.set(1, 0.4, 1.5);
  wheel.rotation.y = -Math.PI / 6;
  const geometry = new THREE.BoxGeometry(0.2, 0.7, 0.7),
    material = new THREE.MeshStandardMaterial();
  wheel.add(new THREE.Mesh(geometry, material));
  template.add(wheel);
  const car = createCar(template);
  car.update(0, 0, false, false, 0);
  const neutral = new THREE.Box3().setFromObject(car.group).getSize(new THREE.Vector3());
  expect(neutral.x).toBeCloseTo(0.2, 4);
  car.update(0, 1, false, false, 0);
  const steering = new THREE.Box3().setFromObject(car.group).getSize(new THREE.Vector3());
  expect(steering.x).toBeGreaterThan(neutral.x + 0.1);
  car.dispose();
  geometry.dispose();
  material.dispose();
});

it('keeps base PBR paint and albedo in the lightweight material path', () => {
  const template = new THREE.Group(),
    geometry = new THREE.BoxGeometry(2, 1, 4);
  const albedo = new THREE.Texture(),
    normal = new THREE.Texture();
  const material = new THREE.MeshPhysicalMaterial({ map: albedo, normalMap: normal, clearcoat: 1 });
  material.name = 'Paint 1';
  template.add(new THREE.Mesh(geometry, material));
  const car = createCar(template, true);
  const paints: THREE.MeshStandardMaterial[] = [];
  car.group.traverse((object) => {
    if (object instanceof THREE.Mesh) paints.push(object.material as THREE.MeshStandardMaterial);
  });
  expect(paints).toHaveLength(1);
  expect(paints[0]).toBeInstanceOf(THREE.MeshStandardMaterial);
  expect(paints[0]).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
  expect(paints[0].map).toBe(albedo);
  expect(paints[0].normalMap).toBeNull();
  expect(paints[0].metalness).toBeGreaterThan(0);
  car.dispose();
  geometry.dispose();
  material.dispose();
  albedo.dispose();
  normal.dispose();
});
