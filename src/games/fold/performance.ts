export class ForgePerformance {
  private frames = new Float32Array(300);
  private cursor = 0;
  private count = 0;
  physicsMs = 0;
  renderMs = 0;
  drawCalls = 0;
  frame(ms: number) {
    if (ms <= 0 || ms > 30000) return;
    this.frames[this.cursor++ % this.frames.length] = ms;
    this.count = Math.min(this.count + 1, this.frames.length);
  }
  snapshot() {
    const sorted = Array.from(this.frames.subarray(0, this.count)).sort((a, b) => a - b),
      average = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
      p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
    return {
      fps: average ? 1000 / average : 0,
      frameMs: average,
      onePercentLow: p99 ? 1000 / p99 : 0,
      p99Ms: p99,
      physicsMs: this.physicsMs,
      renderMs: this.renderMs,
      drawCalls: this.drawCalls,
    };
  }
}
