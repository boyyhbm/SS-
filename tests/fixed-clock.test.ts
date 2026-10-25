import { expect, it } from 'vitest';
import { FixedStepClock } from '../src/games/fixed-clock';
import { initialRace, stepRace } from '../src/games/racing-physics';

it('runs identical 30 Hz physics independently of presentation cadence', () => {
  function raceAt(timerStep: number) {
    const clock = new FixedStepClock(),
      state = initialRace();
    for (let tick = 0; tick < Math.round(3 / timerStep); tick++) {
      clock.advance(timerStep, (dt) =>
        stepRace(state, { throttle: 1, brake: 0, steer: 0.3, nitro: false }, dt),
      );
    }
    return state;
  }
  const fast = raceAt(1 / 60),
    delayed = raceAt(0.2);
  expect(delayed).toEqual(fast);
  expect(delayed.lapTime).toBeCloseTo(3, 8);
  expect(delayed.speed).toBeGreaterThan(0);
});

it('bounds catch-up, preserves fractional time and clears the pause backlog', () => {
  const clock = new FixedStepClock();
  let ticks = 0;
  const update = () => {
    ticks++;
  };
  expect(clock.advance(1 / 60, update)).toBe(0);
  expect(clock.advance(1 / 60, update)).toBe(1);
  expect(clock.advance(10, update)).toBe(7);
  expect(ticks).toBe(8);
  expect(clock.remainder).toBeLessThan(clock.step);
  clock.reset();
  expect(clock.remainder).toBe(0);
  expect(clock.advance(NaN, update)).toBe(0);
  expect(clock.advance(-1, update)).toBe(0);
});
