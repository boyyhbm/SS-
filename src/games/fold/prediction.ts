import { ForgePhysics, initializeForgePhysics } from './physics';
import { advanceForgeMovement } from './simulation';
import { FOLD_DT, balance } from './config';
import type { ForgeCommand, ForgePlayer, ForgeSnapshot, ForgeState } from './contracts';
export class ForgePrediction {
  physics: ForgePhysics;
  current: ForgePlayer | null = null;
  previous: ForgePlayer | null = null;
  game: ForgeState | null = null;
  private pending: ForgeCommand[] = [];
  private round = 0;
  private error = { x: 0, y: 0, z: 0 };
  private constructor(public userId: string) {
    this.physics = new ForgePhysics();
  }
  static async create(userId: string) {
    await initializeForgePhysics();
    return new ForgePrediction(userId);
  }
  receive(snapshot: ForgeSnapshot) {
    const game = snapshot.game,
      p = game?.players.find((p) => p.id === this.userId);
    if (!game || !p) return;
    const ack = snapshot.players.find((p) => p.id === this.userId)?.ack ?? -1;
    this.pending = this.pending.filter((c) => c.seq > ack);
    const old = this.current,
      reset = !old || this.round !== game.round || this.game?.phase !== game.phase;
    this.game = game;
    this.round = game.round;
    this.current = { ...p };
    if (!old) this.physics.addPlayer(this.current);
    else this.physics.reset(this.current);
    this.physics.modulesAt(game.nodes);
    if (!reset && (game.phase === 'active' || game.phase === 'overtime'))
      for (const [i, c] of this.pending.entries()) {
        advanceForgeMovement(this.current, c, game.nodes, this.physics, (game.tick + i) * FOLD_DT);
        this.physics.step();
      }
    if (old && !reset) {
      this.error.x += old.x - this.current.x;
      this.error.y += old.y - this.current.y;
      this.error.z += old.z - this.current.z;
      if (Math.hypot(this.error.x, this.error.y, this.error.z) > 1.5)
        this.error = { x: 0, y: 0, z: 0 };
    } else {
      this.pending.length = 0;
      this.error = { x: 0, y: 0, z: 0 };
    }
    this.previous = { ...this.current };
  }
  step(command: ForgeCommand) {
    if (!this.current || !this.game) return;
    this.previous = { ...this.current };
    if (this.game.phase === 'active' || this.game.phase === 'overtime') {
      this.pending.push(command);
      if (this.pending.length > 180) this.pending.shift();
      const time = (this.game.tick + this.pending.length) * FOLD_DT;
      const nodes = this.game.nodes.map((n) =>
        n.phase === 'moving'
          ? {
              ...n,
              progress: Math.max(0, Math.min(1, 1 - (n.until - time) / balance.foldAnimation)),
            }
          : n,
      );
      this.physics.modulesAt(nodes);
      advanceForgeMovement(
        this.current,
        command,
        nodes,
        this.physics,
        (this.game.tick + this.pending.length) * FOLD_DT,
      );
      this.physics.step();
    }
  }
  pose(alpha: number, dt: number) {
    if (!this.current || !this.previous) return null;
    const decay = Math.exp(-18 * dt);
    this.error.x *= decay;
    this.error.y *= decay;
    this.error.z *= decay;
    return {
      x: this.previous.x + (this.current.x - this.previous.x) * alpha + this.error.x,
      y: this.previous.y + (this.current.y - this.previous.y) * alpha + this.error.y,
      z: this.previous.z + (this.current.z - this.previous.z) * alpha + this.error.z,
    };
  }
  dispose() {
    this.physics.dispose();
    this.pending.length = 0;
  }
}
