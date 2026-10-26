import * as THREE from 'three';
import { qualityPresets, type RenderTier } from './quality';
// Layer 0: static city. Layer 1: articulated race cars. Beauty cameras see both.
// Moving cars keep a live shadow; the entire city is not re-rasterized for it.
export function createShadowLighting(
  scene: THREE.Scene,
  tier: RenderTier,
  color: string,
  intensity: number,
  offset: THREE.Vector3,
) {
  const preset = qualityPresets[tier],
    key = new THREE.DirectionalLight(color, intensity * (preset.shadows ? 0.68 : 1));
  const dynamic = preset.shadows ? new THREE.DirectionalLight(color, intensity * 0.32) : undefined;
  const right = new THREE.Vector3().crossVectors(offset, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, offset).normalize();
  const focus = new THREE.Vector3(),
    last = new THREE.Vector3(Infinity, 0, Infinity);
  const setup = (light: THREE.DirectionalLight, layer: number) => {
    light.castShadow = preset.shadows;
    light.shadow.mapSize.set(preset.shadowSize || 512, preset.shadowSize || 512);
    light.shadow.normalBias = 0.025;
    light.shadow.bias = -0.00025;
    const half = preset.shadowDistance / 2;
    Object.assign(light.shadow.camera, {
      left: -half,
      right: half,
      top: half,
      bottom: -half,
      near: 1,
      far: 150,
    });
    light.shadow.camera.layers.set(layer);
    scene.add(light, light.target);
  };
  setup(key, 0);
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  if (dynamic) setup(dynamic, 1);
  const texel = preset.shadowDistance / Math.max(512, preset.shadowSize);
  const place = (light: THREE.DirectionalLight, x: number, z: number) => {
    focus.set(x, 0, z);
    const a = focus.dot(right),
      b = focus.dot(up);
    focus.addScaledVector(right, Math.round(a / texel) * texel - a);
    focus.addScaledVector(up, Math.round(b / texel) * texel - b);
    light.target.position.copy(focus);
    light.position.copy(focus).add(offset);
  };
  return {
    update(x: number, z: number) {
      if (Math.hypot(x - last.x, z - last.z) > 10) {
        place(key, x, z);
        last.set(x, 0, z);
        key.shadow.needsUpdate = true;
      }
      if (dynamic) place(dynamic, x, z);
    },
    dispose() {
      key.shadow.map?.dispose();
      dynamic?.shadow.map?.dispose();
      scene.remove(key, key.target);
      if (dynamic) scene.remove(dynamic, dynamic.target);
    },
  };
}
