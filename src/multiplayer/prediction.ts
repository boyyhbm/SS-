import { initialRace, stepRace, type RaceInput, type RaceState } from '../games/racing-physics';
import { FIXED_DT, type InputCommand, type NetworkPlayer, type RoomSnapshot } from './contracts';
export interface RaceNetworkDriver {
  frame(input: RaceInput, dt: number): RaceState;
  remotePlayers(): NetworkPlayer[];
  car(): string;
}
export class RacePrediction implements RaceNetworkDriver {
  state = initialRace();
  snapshot: RoomSnapshot | null = null;
  pending: InputCommand[] = [];
  sequence = 0;
  accumulator = 0;
  offset = 0;
  connected = true;
  snapshots: RoomSnapshot[] = [];
  corrections = 0;
  lastError = 0;
  visualOffset = { x: 0, z: 0 };
  constructor(
    public userId: string,
    public send: (input: InputCommand) => void,
  ) {}
  receive(snapshot: RoomSnapshot) {
    if (this.snapshot && snapshot.serverTime < this.snapshot.serverTime) return;
    const player = snapshot.players.find((p) => p.id === this.userId);
    if (!player) return;
    const changed =
      this.snapshot?.matchId !== snapshot.matchId || this.snapshot?.phase !== snapshot.phase;
    if (!this.snapshot) this.offset = snapshot.serverTime - Date.now();
    if (changed) {
      this.pending = [];
      this.accumulator = 0;
      this.snapshots = [];
    }
    this.snapshot = snapshot;
    this.sequence = Math.max(this.sequence, player.ack + 1);
    this.pending = this.pending.filter((command) => command.seq > player.ack);
    const corrected = { ...player.state };
    if (snapshot.phase === 'racing' && player.finish === null) {
      for (const command of this.pending) stepRace(corrected, command, FIXED_DT);
    }
    this.lastError = Math.hypot(corrected.x - this.state.x, corrected.z - this.state.z);
    if (this.lastError > 0.1) this.corrections++;
    if (!changed && this.lastError < 8) {
      this.visualOffset.x += this.state.x - corrected.x;
      this.visualOffset.z += this.state.z - corrected.z;
    } else this.visualOffset = { x: 0, z: 0 };
    this.state = corrected;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 32) this.snapshots.shift();
  }
  frame(input: RaceInput, dt: number) {
    if (!this.connected || !this.snapshot || this.snapshot.phase === 'results') return this.state;
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * 5);
    const player = this.snapshot.players.find((p) => p.id === this.userId);
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      const command = { ...input, seq: this.sequence++ };
      const running =
        this.snapshot.phase === 'racing' ||
        (this.snapshot.phase === 'countdown' &&
          this.snapshot.startsAt !== null &&
          Date.now() + this.offset >= this.snapshot.startsAt);
      if (running && player?.finish === null) {
        stepRace(this.state, command, FIXED_DT);
        this.pending.push(command);
        if (this.pending.length > 90) this.pending.shift();
      }
      this.send(command);
    }
    const decay = Math.exp(-dt * 14);
    this.visualOffset.x *= decay;
    this.visualOffset.z *= decay;
    return {
      ...this.state,
      x: this.state.x + this.visualOffset.x,
      z: this.state.z + this.visualOffset.z,
    };
  }
  remotePlayers(): NetworkPlayer[] {
    if (!this.snapshot) return [];
    const snapshot = this.snapshot;
    const target = Date.now() + this.offset - 120;
    const before =
      [...this.snapshots].reverse().find((s) => s.serverTime <= target) ?? this.snapshots[0];
    const after = this.snapshots.find((s) => s.serverTime >= target) ?? this.snapshot;
    if (!before || !after) return [];
    return this.snapshot.players
      .filter((p) => p.id !== this.userId)
      .map((player) => {
        const a = before.players.find((p) => p.id === player.id) ?? player;
        const b = after.players.find((p) => p.id === player.id) ?? player;
        const span = after.serverTime - before.serverTime;
        const t = span > 0 ? Math.min(1, Math.max(0, (target - before.serverTime) / span)) : 1;
        const state = { ...b.state };
        state.x = a.state.x + (b.state.x - a.state.x) * t;
        state.z = a.state.z + (b.state.z - a.state.z) * t;
        state.heading =
          a.state.heading +
          Math.atan2(
            Math.sin(b.state.heading - a.state.heading),
            Math.cos(b.state.heading - a.state.heading),
          ) *
            t;
        // Extrapolate only a short missing tail, never indefinitely on a dead connection.
        const tail =
          snapshot.phase === 'racing'
            ? Math.min(0.1, Math.max(0, (target - after.serverTime) / 1000))
            : 0;
        state.x += b.state.vx * tail;
        state.z += b.state.vz * tail;
        return { ...player, state };
      });
  }
  resetPending() {
    this.pending = [];
  }
  car() {
    return this.snapshot?.players.find((p) => p.id === this.userId)?.car ?? 'silver';
  }
}
