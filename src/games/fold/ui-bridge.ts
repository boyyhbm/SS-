import type { ForgeSnapshot, ForgePlayer } from './contracts';
export interface ForgeFrameStats {
  fps: number;
  frameMs: number;
  onePercentLow: number;
  p99Ms: number;
  physicsMs: number;
  renderMs: number;
  drawCalls: number;
}
// The runtime writes transforms directly; React receives bounded HUD updates.
// Diagnostic events expose copies of already received state, never commands.
export class ForgeUIBridge {
  onFrame: (stats: ForgeFrameStats, hit: boolean) => void = () => {};
  private localAim = { yaw: 0, pitch: 0 };
  aim(yaw: number, pitch: number) { this.localAim.yaw = yaw; this.localAim.pitch = pitch; }
  state(snapshot: ForgeSnapshot, aim: { yaw: number; pitch: number }) {
    this.aim(aim.yaw, aim.pitch);
    // Separate observation storage, never read by input/simulation. Updating
    // the same object at input cadence avoids stale network-cadence feedback
    // in diagnostic device fixtures, without per-step event allocations.
    window.dispatchEvent(new CustomEvent('nexus-forge-aim', { detail: this.localAim }));
    window.dispatchEvent(
      new CustomEvent('nexus-forge-state', {
        detail: snapshot.game ? structuredClone(snapshot.game) : null,
      }),
    );
  }
  frame(
    tick: number | undefined,
    player: ForgePlayer | null,
    stats: ForgeFrameStats,
    hit: boolean,
  ) {
    this.onFrame(stats, hit);
    window.dispatchEvent(
      new CustomEvent('nexus-forge-frame', {
        detail: { tick, player: player ? { ...player } : null, stats },
      }),
    );
  }
}
