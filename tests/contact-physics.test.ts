import { expect, it } from 'vitest';
import { applyContactImpulse, sweepBody, contactTuning } from '../src/games/contact-physics';
const energy = (s: { vx: number; vz: number; impactYaw: number }) =>
  (contactTuning.mass * (s.vx ** 2 + s.vz ** 2)) / 2 +
  (contactTuning.yawInertia * s.impactYaw ** 2) / 2;
it('responds to a frontal wall with bounded restitution, mass and no spurious yaw', () => {
  const s = { vx: 0, vz: 45, heading: 0, impactYaw: 0 };
  const before = energy(s);
  expect(applyContactImpulse(s, 0, -1, 0, 2.3)).toBeGreaterThan(0);
  expect(s.vz).toBeCloseTo(-5.4);
  expect(s.impactYaw).toBe(0);
  expect(energy(s)).toBeLessThan(before);
  expect(applyContactImpulse(s, 0, -1, 0, 2.3)).toBe(0);
});
it('glancing contact preserves tangential sliding, applies torque and loses kinetic energy', () => {
  const s = { vx: 12, vz: 25, heading: 0, impactYaw: 0 };
  const before = energy(s);
  applyContactImpulse(s, -1, 0, 1, 1.2);
  expect(s.vx).toBeLessThan(12);
  expect(s.vz).toBeGreaterThan(10);
  expect(Math.abs(s.impactYaw)).toBeGreaterThan(0);
  expect(energy(s)).toBeLessThan(before);
});
it('CCD hits a thin obstacle even when both endpoints are outside it', () => {
  const gap = (x: number) => Math.abs(x) - 0.02 - 1.05;
  const f = sweepBody(-3, 0, 0, 3, 0, 0, gap);
  expect(f).toBeGreaterThan(0.3);
  expect(f).toBeLessThan(0.33);
  expect(gap(-3 + 6 * f)).toBeGreaterThanOrEqual(0.0029);
  expect(sweepBody(-3, 0, 0, -4, 0, 0, gap)).toBe(1);
});
it('permits tangential sliding and reversing away from a resting wall contact', () => {
  const c = (x: number) => -x - 1.05;
  expect(sweepBody(-1.053, 0, 0, -1.053, 2, 0, c)).toBe(1);
  expect(sweepBody(-1.053, 0, 0, -2.053, 0, 0, c)).toBe(1);
});
