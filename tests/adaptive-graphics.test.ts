import { describe, it, expect } from 'vitest';
import { AdaptiveGraphics, calibratedTier } from '../src/games/visual/adaptive';
describe('measured graphics budget', () => {
  const bad = { frameMs: 27, p95Ms: 35, lowFps: 28, cpuMs: 4, gpuMs: 24, spikes: 2, samples: 60 };
  const good = {
    frameMs: 16.6,
    p95Ms: 17.5,
    lowFps: 58,
    cpuMs: 3,
    gpuMs: 8,
    spikes: 0,
    samples: 120,
  };
  it('removes secondary effects before resolution and enforces cooldown', () => {
    const a = new AdaptiveGraphics();
    for (let i = 0; i < 3; i++) a.observe(bad, i * 1000);
    expect(a.effects).toBe(1);
    expect(a.scale).toBe(1);
    for (let i = 3; i < 9; i++) a.observe(bad, i * 1000);
    expect(a.effects).toBe(1);
    a.observe(bad, 10000);
    expect(a.effects).toBe(0);
    for (let i = 11; i <= 18; i++) a.observe(bad, i * 1000);
    expect(a.scale).toBe(0.95);
  });
  it('requires sustained headroom to restore quality', () => {
    const a = new AdaptiveGraphics(0);
    a.scale = 0.8;
    for (let i = 0; i < 5; i++) a.observe(good, i * 1000);
    expect(a.scale).toBe(0.8);
    a.observe(good, 5000);
    expect(a.scale).toBe(0.85);
    for (let i = 6; i < 13; i++) a.observe(good, i * 1000);
    expect(a.scale).toBe(0.85);
    a.observe(good, 13000);
    expect(a.scale).toBe(0.9);
  });
  it('does not waste image resolution on measured CPU stalls', () => {
    const a = new AdaptiveGraphics(0);
    for (let i = 0; i < 10; i++) a.observe({ ...bad, cpuMs: 32, gpuMs: 5 }, i * 3000);
    expect(a.scale).toBe(1);
  });
  it('rejects invalid calibration and chooses from actual frame intervals', () => {
    expect(calibratedTier([NaN, 0, Infinity], 16384)).toBe('low');
    expect(calibratedTier(Array(8).fill(30), 16384)).toBe('low');
    expect(calibratedTier(Array(8).fill(16.7), 8192)).toBe('medium');
    expect(calibratedTier(Array(8).fill(5), 8192)).toBe('high');
  });
});
