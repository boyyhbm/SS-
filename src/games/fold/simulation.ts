import { balance, FOLD_DT } from './config';
import { foldDefinitions, spawns } from './arena';
import type { ForgeCommand, ForgeEvent, ForgePlayer, ForgeState } from './contracts';
import { ForgePhysics, initializeForgePhysics } from './physics';
import { ForgeArena } from './arena-system';
import { ForgeCombat } from './combat';
export function initialForgePlayer(id: string, slot: number): ForgePlayer {
  return {
    id,
    slot,
    ...spawns[slot % 2],
    pitch: 0,
    hp: balance.hp,
    ammo: balance.magazine,
    reload: 0,
    shot: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    slide: 0,
    slideReady: 0,
    foldCharges: balance.foldCharges,
    impulseReady: 0,
    capture: 0,
    damage: 0,
    holdingNode: null,
    foldHold: 0,
    impulseX: 0,
    impulseZ: 0,
  };
}
export function advanceForgeMovement(
  p: ForgePlayer,
  c: ForgeCommand,
  nodes: ForgeState['nodes'],
  physics: ForgePhysics,
  time: number,
) {
  p.slide = Math.max(0, p.slide - FOLD_DT);
  if (c.slide && p.grounded && time >= p.slideReady && Math.hypot(p.vx, p.vz) > 3) {
    p.slide = balance.slideSeconds;
    p.slideReady = time + balance.slideCooldown;
  }
  physics.move(p, c, nodes);
}
export class ForgeSimulation {
  readonly physics: ForgePhysics;
  readonly arena = new ForgeArena();
  readonly combat = new ForgeCombat();
  readonly state: ForgeState;
  private eventSequence = 0;
  static async create(ids: string[]) {
    await initializeForgePhysics();
    return new ForgeSimulation(ids);
  }
  private constructor(ids: string[]) {
    this.physics = new ForgePhysics();
    this.state = {
      tick: 0,
      phase: 'prepare',
      round: 1,
      score: [0, 0],
      phaseStarted: 0,
      roundStarted: 0,
      winner: null,
      roundWinner: null,
      reason: '',
      players: ids.map(initialForgePlayer),
      nodes: [],
      events: [],
    };
    for (const p of this.state.players) this.physics.addPlayer(p);
    this.resetRound();
  }
  private event = (type: ForgeEvent['type'], p: ForgePlayer, target?: ForgePlayer) => {
    this.state.events.push({
      id: ++this.eventSequence,
      tick: this.state.tick,
      type,
      playerId: p.id,
      targetId: target?.id,
      x: p.x,
      y: p.y,
      z: p.z,
    });
    if (this.state.events.length > 32) this.state.events.shift();
  };
  private resetRound() {
    const s = this.state;
    s.phase = 'prepare';
    s.phaseStarted = s.tick;
    s.roundWinner = null;
    s.reason = '';
    s.nodes = foldDefinitions.map((d) => ({
      id: d.id,
      state: 0,
      target: 0,
      phase: 'idle',
      progress: 0,
      until: 0,
      availableAt: 0,
      activator: null,
    }));
    s.players.forEach((p) => {
      const slot = s.round % 2 === 0 ? 1 - p.slot : p.slot;
      Object.assign(p, initialForgePlayer(p.id, slot), { slot: p.slot });
      this.physics.reset(p);
    });
    this.physics.modulesAt(s.nodes);
    this.combat.reset();
  }
  step(inputs: Map<string, ForgeCommand>) {
    const s = this.state;
    if (s.phase === 'finished') return;
    s.tick++;
    const since = (s.tick - s.phaseStarted) * FOLD_DT;
    if (s.phase === 'prepare') {
      this.physics.step();
      if (since >= balance.preparation) {
        s.phase = 'active';
        s.phaseStarted = s.tick;
        s.roundStarted = s.tick;
        this.event('round', s.players[0]);
      }
      return;
    }
    if (s.phase === 'round-end') {
      if (since >= balance.intermission) {
        if (Math.max(...s.score) >= balance.firstTo || s.round >= balance.maxRounds) {
          s.phase = 'finished';
          s.winner =
            s.score[0] === s.score[1] ? null : s.players[s.score[0] > s.score[1] ? 0 : 1].id;
        } else {
          s.round++;
          this.resetRound();
        }
      }
      return;
    }
    this.arena.update(s, inputs, this.physics, (type, p) => this.event(type, p));
    this.physics.modulesAt(s.nodes);
    for (const p of s.players) {
      const c = inputs.get(p.id);
      if (p.hp <= 0 || !c) continue;
      const ground = p.grounded,
        slide = p.slide;
      advanceForgeMovement(p, c, s.nodes, this.physics, s.tick * FOLD_DT);
      if (c.jump && ground && !p.grounded) this.event('jump', p);
      if (!ground && p.grounded) this.event('land', p);
      if (slide <= 0 && p.slide > 0) this.event('slide', p);
    }
    this.physics.step();
    this.combat.record(s);
    this.combat.update(s, inputs, this.physics, this.event);
    const alive = s.players.filter((p) => p.hp > 0);
    if (alive.length < 2) {
      this.endRound(alive[0]?.id ?? null, 'elimination');
      return;
    }
    const elapsed = (s.tick - s.roundStarted) * FOLD_DT;
    if (elapsed >= balance.coreUnlock) {
      const inside = s.players.filter((p) => Math.hypot(p.x, p.z) < balance.coreRadius && p.y < 2);
      for (const p of s.players) if (!inside.includes(p)) p.capture = 0;
      if (inside.length === 1) {
        const p = inside[0];
        p.capture += FOLD_DT;
        if (p.capture >= balance.coreCapture) {
          this.event('core', p);
          this.endRound(p.id, 'core-override');
          return;
        }
      }
    }
    if (s.phase === 'active' && elapsed >= balance.roundSeconds) {
      s.phase = 'overtime';
      s.phaseStarted = s.tick;
    }
    if (s.phase === 'overtime' && (s.tick - s.phaseStarted) * FOLD_DT >= balance.overtimeSeconds) {
      const [a, b] = s.players;
      const advantage =
        a.capture - b.capture ||
        a.hp - b.hp ||
        a.damage - b.damage ||
        Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z);
      this.endRound(
        Math.abs(advantage) < 0.001 ? null : advantage > 0 ? a.id : b.id,
        'overtime-verdict',
      );
    }
  }
  private endRound(id: string | null, reason: string) {
    const s = this.state;
    s.roundWinner = id;
    s.reason = reason;
    s.phase = 'round-end';
    s.phaseStarted = s.tick;
    const p = s.players.find((p) => p.id === id);
    if (p) s.score[p.slot]++;
  }
  forfeit(id: string) {
    const winner = this.state.players.find((p) => p.id !== id);
    this.state.winner = winner?.id ?? null;
    this.state.reason = 'disconnect';
    this.state.phase = 'finished';
  }
  snapshot() {
    return structuredClone(this.state);
  }
  dispose() {
    this.physics.dispose();
  }
}
