import * as THREE from 'three';

// Offsets are expressed in vehicle metres. Speed never changes follow distance.
export const cameraProfiles = [
  { name: 'Chase', distance: 7.8, height: 2.65, lookAhead: 5, targetHeight: 0.85 },
  { name: 'Close Chase', distance: 5.8, height: 2.05, lookAhead: 4, targetHeight: 0.8 },
  { name: 'Hood', distance: -1.35, height: 1.02, lookAhead: 14, targetHeight: 0.95 },
  { name: 'Showcase', distance: -5.8, height: 1.9, lookAhead: 0, targetHeight: 0.8 },
] as const;
export const cameraTuning = { headingResponse: 7, baseFov: 58, maxDynamicFov: 0.8 };
export type CameraPose = { x: number; z: number; heading: number; speed: number };
export function avoidCameraObstacles(
  target: THREE.Vector3,
  desired: THREE.Vector3,
  boxes: readonly THREE.Box3[],
) {
  const direction = new THREE.Vector3().subVectors(desired, target),
    length = direction.length();
  if (length < 0.001) return;
  direction.normalize();
  const ray = new THREE.Ray(target, direction),
    hit = new THREE.Vector3();
  let allowed = length;
  for (const box of boxes)
    if (ray.intersectBox(box, hit)) {
      const distance = hit.distanceTo(target) - 0.35;
      if (distance >= 0) allowed = Math.min(allowed, distance);
    }
  if (allowed < length) desired.copy(target).addScaledVector(direction, Math.max(0.25, allowed));
}
export class ChaseCameraRig {
  private heading = 0;
  private initialized = false;
  private mode = -1;
  private target = new THREE.Vector3();
  constructor(readonly camera: THREE.PerspectiveCamera) {}
  reset() {
    this.initialized = false;
  }
  update(
    pose: CameraPose,
    dt: number,
    mode = 0,
    dynamicFov = false,
    reducedMotion = false,
    clip?: (target: THREE.Vector3, desired: THREE.Vector3) => void,
  ) {
    const profile = cameraProfiles[mode] ?? cameraProfiles[0];
    if (!this.initialized || this.mode !== mode || reducedMotion) this.heading = pose.heading;
    else {
      const delta = Math.atan2(
        Math.sin(pose.heading - this.heading),
        Math.cos(pose.heading - this.heading),
      );
      this.heading += delta * (1 - Math.exp(-cameraTuning.headingResponse * dt));
    }
    this.initialized = true;
    this.mode = mode;
    const sin = Math.sin(this.heading),
      cos = Math.cos(this.heading);
    // Follow translation exactly; smooth only orbit heading. World-position lerp used to
    // add speed / response metres of lag (8.3 m at 150 km/h with the old response of 5).
    this.camera.position.set(
      pose.x - sin * profile.distance,
      profile.height,
      pose.z - cos * profile.distance,
    );
    if (mode === 3) this.camera.position.add(new THREE.Vector3(-cos * 5.1, 0, sin * 5.1));
    this.target.set(
      pose.x + sin * profile.lookAhead,
      profile.targetHeight,
      pose.z + cos * profile.lookAhead,
    );
    clip?.(this.target, this.camera.position);
    this.camera.lookAt(this.target);
    this.camera.fov =
      cameraTuning.baseFov +
      (dynamicFov && !reducedMotion
        ? Math.min(1, Math.max(0, pose.speed) / 50) * cameraTuning.maxDynamicFov
        : 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}

export function projectedHeight(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  transform?: THREE.Matrix4,
) {
  let min = Infinity,
    max = -Infinity;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z);
        if (transform) p.applyMatrix4(transform);
        p.project(camera);
        min = Math.min(min, p.y);
        max = Math.max(max, p.y);
      }
  return (max - min) / 2;
}
