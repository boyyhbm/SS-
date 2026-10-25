import { expect, it } from 'vitest';
import * as THREE from 'three';
import { ChaseCameraRig, projectedHeight, avoidCameraObstacles } from '../src/games/visual/camera';
it('avoids a parked car, facade or thin street pole and preserves clear-space distance', () => {
  const target = new THREE.Vector3(0, 1, 0),
    desired = new THREE.Vector3(0, 2, -8);
  avoidCameraObstacles(target, desired, [
    new THREE.Box3(new THREE.Vector3(-1, 0, -7), new THREE.Vector3(1, 4, -5)),
  ]);
  expect(desired.z).toBeGreaterThan(-5);
  expect(desired.z).toBeLessThan(-4);
  const clear = new THREE.Vector3(0, 2, -8);
  avoidCameraObstacles(target, clear, [
    new THREE.Box3(new THREE.Vector3(10, 0, -7), new THREE.Vector3(11, 4, -5)),
  ]);
  expect(clear.z).toBe(-8);
  const pole = new THREE.Vector3(0, 2, -8);
  avoidCameraObstacles(target, pole, [
    new THREE.Box3(new THREE.Vector3(-0.1, 0, -4), new THREE.Vector3(0.1, 7, -3.8)),
  ]);
  expect(pole.z).toBeGreaterThan(-3.8);
});

it('keeps projected car height within 5% at 0/50/100/150 km/h, including acceleration and braking', () => {
  for (const dynamic of [false, true]) {
    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 700),
      rig = new ChaseCameraRig(camera);
    const heights: number[] = [];
    let z = 0;
    for (const kph of [0, 50, 100, 150, 100, 0]) {
      for (let i = 0; i < 45; i++) {
        z += kph / 3.6 / 30;
        rig.update({ x: 0, z, heading: 0, speed: kph / 3.6 }, 1 / 30, 0, dynamic);
        const box = new THREE.Box3(
          new THREE.Vector3(-1, 0.03, z - 2.3),
          new THREE.Vector3(1, 1.35, z + 2.3),
        );
        heights.push(projectedHeight(camera, box));
        expect(Math.hypot(camera.position.x, camera.position.z - z)).toBeCloseTo(7.8, 8);
      }
    }
    expect((Math.max(...heights) - Math.min(...heights)) / heights[0]).toBeLessThan(0.05);
  }
});

it('handles heading wrap, different render rates and close/hood camera changes without translation lag', () => {
  for (const fps of [30, 60, 120]) {
    const camera = new THREE.PerspectiveCamera(),
      rig = new ChaseCameraRig(camera);
    rig.update({ x: 0, z: 0, heading: Math.PI - 0.01, speed: 0 }, 1 / fps);
    rig.update({ x: 2, z: 1, heading: -Math.PI + 0.01, speed: 40 }, 1 / fps);
    expect(camera.position.distanceTo(new THREE.Vector3(2, 2.65, 1))).toBeCloseTo(7.8, 8);
    rig.update({ x: 2, z: 1, heading: 0, speed: 0 }, 1 / fps, 1);
    expect(camera.position.z).toBeCloseTo(1 - 5.8);
    rig.update({ x: 2, z: 1, heading: 0, speed: 0 }, 1 / fps, 2);
    expect(camera.position.z).toBeCloseTo(2.35);
  }
});
