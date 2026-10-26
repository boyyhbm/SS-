// No renderer, device-name heuristic, React state, or game simulation in this policy.
export interface FrameBudgetSample {
  frameMs: number;
  p95Ms: number;
  lowFps: number;
  cpuMs: number;
  gpuMs: number | null;
  spikes: number;
  samples: number;
}
export class AdaptiveGraphics {
  scale = 1;
  effects = 2;
  private bad = 0;
  private good = 0;
  private changedAt = -Infinity;
  constructor(private maxEffects = 2) {
    this.effects = maxEffects;
  }
  observe(s: FrameBudgetSample, now: number) {
    if (s.samples < 2 || !Number.isFinite(s.frameMs) || s.frameMs <= 0) return false;
    const overloaded = s.frameMs > 20 || s.p95Ms > 30 || s.lowFps < 35;
    const headroom =
      s.p95Ms < 20 &&
      s.spikes === 0 &&
      s.cpuMs < 10 &&
      (s.gpuMs !== null ? s.gpuMs < 11 : s.frameMs < 16.8);
    this.bad = overloaded ? this.bad + 1 : 0;
    this.good = headroom ? this.good + 1 : 0;
    if (now - this.changedAt < 8000) return false;
    if (this.bad >= 3) {
      this.bad = 0;
      if (this.effects > 0) this.effects--;
      // Resolution does not fix a measured CPU bottleneck with GPU headroom.
      else if ((s.gpuMs === null || s.gpuMs >= 13 || s.cpuMs < 12) && this.scale > 0.65)
        this.scale = Math.max(0.65, Math.round((this.scale - 0.05) * 100) / 100);
      else return false;
    } else if (this.good >= 6) {
      this.good = 0;
      if (this.scale < 1) this.scale = Math.min(1, Math.round((this.scale + 0.05) * 100) / 100);
      else if (this.effects < this.maxEffects) this.effects++;
      else return false;
    } else return false;
    this.changedAt = now;
    return true;
  }
}
// A real, short pre-race render sample chooses an initial quality candidate.
// A software adapter name never grants a quality tier or a performance claim.
export function calibratedTier(samples: number[], maxTextureSize: number) {
  const valid = samples.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (valid.length < 6) return 'low' as const;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length,
    p95 = valid[Math.ceil(valid.length * 0.95) - 1];
  return mean < 6 && p95 < 9 && maxTextureSize >= 8192
    ? ('high' as const)
    : mean < 17.5 && p95 < 23 && maxTextureSize >= 4096
      ? ('medium' as const)
      : ('low' as const);
}
