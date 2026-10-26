import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Batch static glTF panels, keeping transforms and quantized accessor values correct.
// Articulated wheel groups are passed separately from the body.
export function batchStaticMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[] }>();
  const originals: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const geometry = object.geometry.clone();
    // Normalize accessor storage, not its values. Quantized UVs and float UVs
    // may describe the same material but previously forced separate draw calls.
    for (const key of Object.keys(geometry.attributes)) {
      if (key === 'skinIndex') continue;
      const attribute = geometry.getAttribute(key);
      if (!attribute) continue;
      const values = new Float32Array(attribute.count * attribute.itemSize);
      for (let i = 0; i < attribute.count; i++)
        for (let component = 0; component < attribute.itemSize; component++)
          values[i * attribute.itemSize + component] = attribute.getComponent(i, component);
      geometry.setAttribute(key, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    if (!(object.material instanceof THREE.ShaderMaterial)) {
      const channels = new Set<number>();
      for (const value of Object.values(object.material))
        if (value instanceof THREE.Texture && value.mapping === THREE.UVMapping)
          channels.add(value.channel);
      for (const key of Object.keys(geometry.attributes))
        if (/^uv[123]?$/.test(key) && !channels.has(key === 'uv' ? 0 : Number(key.slice(2))))
          geometry.deleteAttribute(key);
    }
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const key =
      object.material.uuid +
      Boolean(geometry.index) +
      Object.keys(geometry.attributes)
        .sort()
        .map((name) => {
          const a = geometry.getAttribute(name);
          return name + a.array.constructor.name + a.itemSize + a.normalized;
        })
        .join(',');
    const batch: { material: THREE.Material; parts: THREE.BufferGeometry[] } = batches.get(key) ?? {
      material: object.material,
      parts: [],
    };
    batch.parts.push(geometry);
    batches.set(key, batch);
    originals.push(object);
  });
  originals.forEach((object) => object.removeFromParent());
  const group = new THREE.Group(),
    geometries: THREE.BufferGeometry[] = [];
  for (const { material, parts } of batches.values()) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!geometry) throw Error('Incompatible reviewed static geometry');
    geometries.push(geometry);
    group.add(new THREE.Mesh(geometry, material));
  }
  root.add(group);
  return { group, geometries };
}
