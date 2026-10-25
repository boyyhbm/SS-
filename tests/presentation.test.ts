import { expect, it } from 'vitest';
import { RacePresentation, angleDelta } from '../src/games/presentation';
import { initialRace } from '../src/games/racing-physics';
import { FixedStepClock } from '../src/games/fixed-clock';
it.each([30, 60, 120])(
  'interpolates 30Hz translation, yaw, wheels and camera source at %iHz',
  (fps) => {
    const state = initialRace(),
      buffer = new RacePresentation(state),
      clock = new FixedStepClock();
    let oldX = state.x,
      oldHeading = 0;
    const increments: number[] = [];
    for (let i = 0; i < fps * 3; i++) {
      clock.advance(1 / fps, (dt) => {
        state.x += 30 * dt;
        state.heading += dt;
        state.steering += dt * 0.1;
        buffer.push(state);
      });
      const p = buffer.sample(clock.remainder / clock.step);
      if (i > fps) increments.push(p.x - oldX);
      expect(Math.abs(angleDelta(oldHeading, p.heading))).toBeLessThanOrEqual(1 / fps + 1e-8);
      oldX = p.x;
      oldHeading = p.heading;
    }
    expect(Math.max(...increments) - Math.min(...increments)).toBeLessThan(1e-8);
    expect(increments[0]).toBeCloseTo(30 / fps, 8);
  },
);
it('crosses +pi/-pi by the shortest yaw arc and resets grid/route without blending', () => {
  const s = initialRace();
  s.heading = Math.PI - 0.02;
  const b = new RacePresentation(s);
  s.heading = -Math.PI + 0.02;
  s.steering = 1;
  b.push(s);
  expect(b.sample(0.5).heading).toBeCloseTo(Math.PI);
  expect(b.sample(0.5).steering).toBeCloseTo(0.5);
  s.x = -300;
  b.push(s);
  expect(b.sample(0).x).toBe(-300);
  b.reset(initialRace());
  expect(b.sample(0.5).x).toBe(95);
});
it('does not change physics or extrapolate through contacts and freezes on the newest pose', () => {
  const s = initialRace(),
    b = new RacePresentation(s);
  s.x += 1;
  b.push(s);
  expect(b.sample(1.8).x).toBe(s.x);
  expect(b.sample(0, true).x).toBe(s.x);
  expect(s.x).toBe(96);
});
