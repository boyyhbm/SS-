import type { AudioEnvironment } from './config';
// Original procedural sound design, not field recordings. Slow envelopes and
// a tapered loop seam keep ambience quiet and avoid clicks at the boundary.
export function fillSoundscape(out: Float32Array, rate: number, environment: AudioEnvironment) {
  let seed = 9831,
    low = 0,
    air = 0;
  const duration = out.length / rate;
  for (let i = 0; i < out.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const t = i / rate,
      n = (seed / 0xffffffff) * 2 - 1;
    low += (n - low) * 0.026;
    air += (n - air) * 0.18;
    let sample = 0;
    if (environment === 'industrial')
      sample =
        low * 0.75 +
        Math.sin(2 * Math.PI * 60 * t) * 0.035 +
        Math.sin(2 * Math.PI * 120 * t) * 0.013;
    else if (environment === 'coast')
      sample = air * (0.32 + 0.24 * Math.sin((2 * Math.PI * t) / 8) ** 2) + low * 0.5;
    else if (environment === 'mountain') {
      const chirp = (t % 4.5) - 1.5,
        envelope = chirp > 0 && chirp < 0.3 ? Math.sin((Math.PI * chirp) / 0.3) ** 2 : 0;
      sample =
        low * (0.45 + 0.2 * Math.sin(t * 0.7) ** 2) +
        Math.sin(2 * Math.PI * (1900 * chirp + 550 * chirp * chirp)) * envelope * 0.012;
    } else if (environment === 'circuit')
      sample =
        air * 0.06 +
        low * 0.45 +
        Math.sin(2 * Math.PI * 98 * t) * (0.008 + 0.008 * Math.sin(t * 0.6));
    else sample = low * 0.8 + air * (0.06 + 0.05 * Math.sin((2 * Math.PI * t) / 5) ** 2);
    const fade = Math.min(1, t / 0.05, (duration - t) / 0.05);
    out[i] = sample * Math.max(0, fade);
  }
}
