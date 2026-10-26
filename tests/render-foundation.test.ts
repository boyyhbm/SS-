import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { prepareTexture } from '../src/games/visual/texture-budget';
import { GpuTimer } from '../src/games/visual/gpu-timer';
import { batchStaticMeshes } from '../src/games/visual/geometry';
import { createShadowLighting } from '../src/games/visual/lighting';
describe('render foundation', () => {
  it('trims only authored compressed mip levels before upload and preserves color semantics', () => {
    const map = new THREE.CompressedTexture(
      [
        { width: 8, height: 8, data: new Uint8Array(64) },
        { width: 4, height: 4, data: new Uint8Array(16) },
        { width: 2, height: 2, data: new Uint8Array(4) },
      ],
      8,
      8,
    );
    map.colorSpace = THREE.SRGBColorSpace;
    prepareTexture(map, 4, 4);
    expect(map.mipmaps).toHaveLength(2);
    expect(map.image.width).toBe(4);
    expect(map.image.height).toBe(4);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(map.anisotropy).toBe(4);
  });
  it('never blocks waiting for an unfinished GPU query and discards disjoint results', () => {
    const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
    let available = false,
      disjoint = false;
    const gl = {
      getExtension: () => ext,
      createQuery: () => ({}),
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      deleteQuery: vi.fn(),
      QUERY_RESULT_AVAILABLE: 3,
      QUERY_RESULT: 4,
      getParameter: () => disjoint,
      getQueryParameter: vi.fn((_: unknown, key: number) => (key === 3 ? available : 12300000)),
    };
    const timer = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    timer.begin();
    timer.end();
    expect(timer.poll()).toBeNull();
    expect(gl.getQueryParameter).toHaveBeenCalledTimes(1);
    available = true;
    expect(timer.poll()).toBeCloseTo(12.3);
    timer.begin();
    timer.end();
    disjoint = true;
    expect(timer.poll()).toBeNull();
    expect(gl.deleteQuery).toHaveBeenCalledTimes(2);
  });
  it('reports unavailable GPU timing explicitly', () => {
    const timer = new GpuTimer({ getExtension: () => null } as unknown as WebGL2RenderingContext);
    timer.begin();
    timer.end();
    expect(timer.available).toBe(false);
    expect(timer.poll()).toBeNull();
    timer.dispose();
  });
  it('batches differently stored normalized UVs without corrupting values', () => {
    const root = new THREE.Group(),
      map = new THREE.Texture(),
      mat = new THREE.MeshStandardMaterial({ map });
    for (const packed of [true, false]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      g.setAttribute(
        'uv',
        packed
          ? new THREE.BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true)
          : new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2),
      );
      g.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
      const m = new THREE.Mesh(g, mat);
      m.position.x = packed ? 0 : 2;
      root.add(m);
    }
    const batch = batchStaticMeshes(root);
    expect(batch.group.children).toHaveLength(1);
    const g = batch.geometries[0];
    expect(g.getAttribute('uv').getX(4)).toBeCloseTo(1);
    expect(g.getAttribute('position').getX(4)).toBe(3);
    expect(g.getAttribute('uv1')).toBeUndefined();
  });
  it('separates cached static and live car shadows and only refreshes distant city cells', () => {
    const scene = new THREE.Scene(),
      lighting = createShadowLighting(scene, 'high', '#ffffff', 1, new THREE.Vector3(-30, 45, -18));
    const lights = scene.children.filter((x) => x instanceof THREE.DirectionalLight);
    expect(lights).toHaveLength(2);
    expect(lights[0].shadow.camera.layers.mask).toBe(1);
    expect(lights[1].shadow.camera.layers.mask).toBe(2);
    lighting.update(0, 0);
    lights[0].shadow.needsUpdate = false;
    lighting.update(1, 0);
    expect(lights[0].shadow.needsUpdate).toBe(false);
    lighting.update(12, 0);
    expect(lights[0].shadow.needsUpdate).toBe(true);
    lighting.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
