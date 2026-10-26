import { expect, it } from 'vitest';
import {
  audioSettingsSchema,
  conceptAudioProfile,
  defaultAudioSettings,
} from '../src/games/audio/config';
import { EngineSoundTelemetry, engineLayerWeights } from '../src/games/audio/telemetry';
const idle = { throttle: 0, brake: 0, steer: 0, nitro: false };
it('blends neighboring engine bands without an energy step or invalid gains', () => {
  for (let rpm = 850; rpm < 10000; rpm += 11) {
    const gains = engineLayerWeights(rpm, 850, 7600);
    expect(gains.every((g) => Number.isFinite(g) && g >= 0 && g <= 1)).toBe(true);
    expect(gains.reduce((e, g) => e + g * g, 0)).toBeCloseTo(1, 10);
  }
});
it('raises RPM on throttle, shifts with hysteresis and responds to engine braking', () => {
  const engine = new EngineSoundTelemetry(conceptAudioProfile);
  const state = { speed: 0, vx: 0, vz: 0, heading: 0 };
  let sound = engine.update(state, idle, 1 / 30);
  expect(sound.rpm).toBeCloseTo(conceptAudioProfile.idleRPM);
  for (let i = 0; i < 30; i++) sound = engine.update(state, { ...idle, throttle: 1 }, 1 / 30);
  expect(sound.rpm).toBeGreaterThan(3000);
  let shifts = 0;
  for (let i = 0; i < 240; i++) {
    state.speed = (i / 240) * 55;
    state.vz = state.speed;
    sound = engine.update(state, { ...idle, throttle: 1 }, 1 / 30);
    shifts += Number(sound.shift);
  }
  expect(shifts).toBeGreaterThan(1);
  expect(shifts).toBeLessThan(7);
  const runningRPM = sound.rpm;
  state.speed = 8;
  state.vz = 8;
  for (let i = 0; i < 100; i++) sound = engine.update(state, { ...idle, brake: 1 }, 1 / 30);
  expect(sound.rpm).toBeLessThan(runningRPM);
  expect(sound.load).toBe(0);
});
it('keeps quiet tires on a straight and derives squeal from actual lateral slip', () => {
  const engine = new EngineSoundTelemetry(conceptAudioProfile);
  const state = { speed: 20, vx: 0, vz: 20, heading: 0 };
  expect(engine.update(state, { ...idle, steer: 0.1 }, 1 / 30).slip).toBe(0);
  state.vx = 9;
  expect(engine.update(state, idle, 1 / 30).slip).toBeGreaterThan(0.8);
  state.speed = 0;
  state.vx = 0;
  state.vz = 0;
  expect(engine.update(state, idle, 1 / 30).rolling).toBe(0);
});
it('validates finite account volumes and refuses extra ownership/settings fields', () => {
  expect(audioSettingsSchema.safeParse(defaultAudioSettings).success).toBe(true);
  for (const master of [-1, 1.01, Infinity, NaN])
    expect(audioSettingsSchema.safeParse({ ...defaultAudioSettings, master }).success).toBe(false);
  expect(
    audioSettingsSchema.safeParse({ ...defaultAudioSettings, userId: 'another-user' }).success,
  ).toBe(false);
});
