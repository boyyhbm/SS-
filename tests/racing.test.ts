import { describe, expect, it } from 'vitest';
import {
  initialRace,
  stepRace,
  TRACK_RADIUS,
  ROAD_HALF_WIDTH,
  timeLabel,
} from '../src/games/racing-physics';
const idle = { throttle: 0, brake: 0, steer: 0, nitro: false };
describe('arcade racing simulation', () => {
  it('accelerates, brakes and consumes/recharges nitro', () => {
    const state = initialRace();
    for (let i = 0; i < 40; i++) stepRace(state, { ...idle, throttle: 1, nitro: true }, 1 / 60);
    expect(state.speed).toBeGreaterThan(15);
    expect(state.nitro).toBeLessThan(90);
    const nitro = state.nitro;
    for (let i = 0; i < 60; i++) stepRace(state, { ...idle, brake: 1 }, 1 / 60);
    expect(state.speed).toBe(0);
    expect(state.nitro).toBeGreaterThan(nitro);
  });
  it('collides with both track boundaries and loses speed', () => {
    for (const side of [-1, 1]) {
      const state = initialRace();
      state.x = TRACK_RADIUS + side * (ROAD_HALF_WIDTH + 2);
      state.speed = 40;
      stepRace(state, idle, 1 / 60);
      expect(state.collision).toBe(true);
      expect(Math.hypot(state.x, state.z)).toBeLessThanOrEqual(TRACK_RADIUS + ROAD_HALF_WIDTH);
      expect(Math.hypot(state.x, state.z)).toBeGreaterThanOrEqual(TRACK_RADIUS - ROAD_HALF_WIDTH);
      expect(state.speed).toBeLessThan(30);
    }
  });
  it('requires checkpoint order, correct direction and a full lap', () => {
    const state = initialRace();
    state.lapTime = 20;
    const visit = (cp: number, backwards = false) => {
      const a = (cp * Math.PI) / 2;
      state.x = Math.cos(a) * TRACK_RADIUS;
      state.z = Math.sin(a) * TRACK_RADIUS;
      state.heading = -a + (backwards ? Math.PI : 0);
      state.speed = 10;
      state.vx = 0;
      state.vz = 0;
      return stepRace(state, idle, 1 / 60);
    };
    expect(visit(0)).toBeNull();
    expect(state.nextCheckpoint).toBe(1);
    expect(visit(1, true)).toBeNull();
    expect(state.nextCheckpoint).toBe(1);
    expect(visit(1)).toBeNull();
    expect(state.nextCheckpoint).toBe(2);
    visit(2);
    visit(3);
    const time = visit(4);
    expect(time).toBeGreaterThan(20);
    expect(state.lap).toBe(2);
    expect(state.bestLap).toBe(time);
    expect(state.nextCheckpoint).toBe(1);
  });
  it('can complete a real simulated lap with a feedback driver', () => {
    const state = initialRace();
    let completed: number | null = null;
    for (let frame = 0; frame < 7200; frame++) {
      const angle = Math.atan2(state.z, state.x);
      const desired = -angle;
      const headingError = Math.atan2(
        Math.sin(desired - state.heading),
        Math.cos(desired - state.heading),
      );
      const radiusError = Math.hypot(state.x, state.z) - TRACK_RADIUS;
      const steer = Math.max(
        -1,
        Math.min(1, -headingError * 2.8 + radiusError * 0.09 + state.speed / (TRACK_RADIUS * 1.12)),
      );
      completed = stepRace(state, { ...idle, throttle: 1, steer }, 1 / 60);
      if (completed !== null) break;
    }
    expect(completed).not.toBeNull();
    expect(completed).toBeGreaterThan(8);
    expect(state.lap).toBe(2);
  });
  it('clamps long frames, never drives in reverse and formats time', () => {
    const state = initialRace();
    stepRace(state, { ...idle, brake: 1 }, 10);
    expect(state.lapTime).toBe(0.05);
    expect(state.speed).toBe(0);
    expect(timeLabel(65.25)).toBe('01:05.25');
  });
});

it('right input turns toward screen-right for the rear camera looking along +Z', () => {
  const state = initialRace();
  state.speed = 20;
  stepRace(state, { throttle: 0, brake: 0, steer: 1, nitro: false }, 0.05);
  expect(state.heading).toBeLessThan(0);
  expect(state.vx).toBeLessThan(0);
});
