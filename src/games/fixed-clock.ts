// Simulation time is independent of presentation frames. Catch-up is bounded after
// a stalled JavaScript thread; hidden single-player sessions reset this clock.
export class FixedStepClock {
  remainder = 0;
  constructor(
    readonly step = 1 / 30,
    readonly maxCatchup = 0.25,
  ) {}
  reset() {
    this.remainder = 0;
  }
  advance(elapsed: number, update: (dt: number) => void) {
    if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
    this.remainder = Math.min(this.maxCatchup, this.remainder + elapsed);
    let steps = 0;
    while (this.remainder + 1e-9 >= this.step) {
      update(this.step);
      this.remainder = Math.max(0, this.remainder - this.step);
      steps++;
    }
    return steps;
  }
}
