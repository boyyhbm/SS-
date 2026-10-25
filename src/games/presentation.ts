import type { RaceState } from './racing-physics';
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const channels = ['x', 'z', 'speed', 'vx', 'vz', 'steering', 'nitro'] as const;
// One writer (fixed simulation), one reader (render). Never feed interpolated poses
// back into physics. Retain one tick of latency, rather than extrapolating contacts.
export class RacePresentation {
  private previous: RaceState;
  private current: RaceState;
  readonly visual: RaceState;
  constructor(state: RaceState) {
    this.previous = { ...state };
    this.current = { ...state };
    this.visual = { ...state };
  }
  reset(state: RaceState) {
    Object.assign(this.previous, state);
    Object.assign(this.current, state);
    Object.assign(this.visual, state);
  }
  push(state: RaceState) {
    Object.assign(this.previous, this.current);
    Object.assign(this.current, state);
    if (Math.hypot(state.x - this.previous.x, state.z - this.previous.z) > 8) this.reset(state); // Explicit grid/route reset, never a long interpolation across town.
  }
  sample(alpha: number, frozen = false) {
    const t = frozen ? 1 : Math.max(0, Math.min(1, alpha));
    Object.assign(this.visual, this.current);
    for (const key of channels)
      this.visual[key] = this.previous[key] + (this.current[key] - this.previous[key]) * t;
    this.visual.heading =
      this.previous.heading + angleDelta(this.previous.heading, this.current.heading) * t;
    if (this.current.lap === this.previous.lap)
      this.visual.lapTime =
        this.previous.lapTime + (this.current.lapTime - this.previous.lapTime) * t;
    return this.visual;
  }
}
