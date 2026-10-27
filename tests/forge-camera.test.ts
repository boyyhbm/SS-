import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { ForgeCamera } from '../src/games/fold/camera';
describe('Forge first-person camera', () => {
  it('applies mouse orientation immediately and crosses the angle boundary without a turn around', () => {
    const c = new ForgeCamera(),
      p = { x: 1, y: 0.9, z: 2 };
    c.update(p, Math.PI - 0.01, 0, false, 0, 1 / 120, false);
    const a = c.camera.getWorldDirection(new Vector3());
    c.update(p, -Math.PI + 0.01, 0, false, 0, 1 / 120, false);
    const b = c.camera.getWorldDirection(new Vector3());
    expect(a.dot(b)).toBeGreaterThan(0.999);
    expect(c.camera.position.y).toBeCloseTo(1.45);
    expect(c.camera.position.x).toBe(1);
  });
  it('limits ADS to a small stable FOV change and restores it independently of movement', () => {
    const c = new ForgeCamera(),
      p = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 120; i++)
      c.update(p, 0, 0, false, i / 120, 1 / 120, false, undefined, true);
    expect(c.camera.fov).toBeGreaterThanOrEqual(64);
    expect(c.camera.fov).toBeLessThan(64.01);
    for (let i = 0; i < 60; i++) c.update(p, 0, 0, false, i / 60, 1 / 60, false);
    expect(c.camera.fov).toBeGreaterThan(75.99);
  });
});
