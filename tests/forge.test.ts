import { describe, it, expect } from 'vitest';
import { ForgeSimulation } from '../src/games/fold/simulation';
import { neutralCommand, foldCommandSchema } from '../src/games/fold/contracts';
import { balance } from '../src/games/fold/config';
import { FixedStepClock } from '../src/games/fixed-clock';
import { driveDuel, newDuelDriver } from './helpers/forge-driver';
async function duel() {
  const sim = await ForgeSimulation.create(['a', 'b']);
  for (let i = 0; i < 181; i++) sim.step(new Map());
  return sim;
}
function place(sim: ForgeSimulation, id: string, x: number, z: number, yaw = 0) {
  const p = sim.state.players.find((p) => p.id === id)!;
  Object.assign(p, { x, y: 0.95, z, yaw, pitch: 0, vx: 0, vy: 0, vz: 0 });
  sim.physics.reset(p);
  return p;
}
function run(sim: ForgeSimulation, count: number, a = neutralCommand(), b = neutralCommand()) {
  for (let i = 0; i < count; i++)
    sim.step(
      new Map([
        ['a', { ...a, seq: i, aimTick: sim.state.tick }],
        ['b', { ...b, seq: i, aimTick: sim.state.tick }],
      ]),
    );
}
describe('NEXUS FORGE authoritative duel', () => {
  it('applies a visible impulse with a real cooldown and interrupts capture without damage', async () => {
    const s = await duel();
    try {
      place(s, 'a', 19, 4);
      const b = place(s, 'b', 19, -1);
      b.capture = 2;
      run(s, 1, { ...neutralCommand(), impulse: true });
      expect(b.impulseZ).toBeLessThan(-7);
      expect(b.capture).toBe(0);
      expect(b.hp).toBe(100);
      const ready = s.state.players[0].impulseReady;
      run(s, 45, { ...neutralCommand(), impulse: true });
      expect(s.state.players[0].impulseReady).toBe(ready);
      expect(b.z).toBeLessThan(-1.7);
    } finally {
      s.dispose();
    }
  });
  it('completes a five-round match through normal navigation, a real fold and weapon input', async () => {
    const sim = await ForgeSimulation.create(['a', 'b']),
      drivers = [newDuelDriver(), newDuelDriver()];
    try {
      for (let i = 0; i < 9000 && sim.state.phase !== 'finished'; i++)
        sim.step(
          new Map(
            sim.state.players.map((p, index) => [
              p.id,
              { ...driveDuel(sim.state, p.id, drivers[index], index === 0, index === 0), seq: i },
            ]),
          ),
        );
      expect(sim.state.phase).toBe('finished');
      expect(sim.state.score).toEqual([5, 0]);
      expect(drivers[0].folded).toBe(true);
    } finally {
      sim.dispose();
    }
  });
  it('runs exactly 60 physics steps per second at 30, 60 and 120 presentation frames', () => {
    for (const fps of [30, 60, 120]) {
      const clock = new FixedStepClock(1 / 60, 0.1);
      let steps = 0;
      for (let i = 0; i < fps * 5; i++) clock.advance(1 / fps, () => steps++);
      expect(steps).toBe(300);
    }
  });
  it('accepts normalized actions only, never position, damage or a claimed target', () => {
    expect(foldCommandSchema.safeParse(neutralCommand()).success).toBe(true);
    for (const extra of [
      { x: 200 },
      { damage: 1000 },
      { target: 'b' },
      { fire: true, moveX: 4 },
      { yaw: Infinity },
    ])
      expect(foldCommandSchema.safeParse({ ...neutralCommand(), ...extra }).success).toBe(false);
  });
  it('moves using fixed steps and collides with the foundry boundary', async () => {
    const s = await duel();
    try {
      const p = place(s, 'a', 18, 10);
      run(s, 480, { ...neutralCommand(), moveX: 1 });
      expect(p.x).toBeLessThan(21.2);
      expect(p.y).toBeGreaterThan(0.85);
      expect(p.grounded).toBe(true);
    } finally {
      s.dispose();
    }
  });
  it('server shots apply damage and settle an elimination; bullets cannot cross spawn shields', async () => {
    const s = await duel();
    try {
      const a = s.state.players[0],
        b = s.state.players[1];
      run(s, 40, { ...neutralCommand(), fire: true });
      expect(b.hp).toBe(100);
      place(s, 'a', 18, 4);
      place(s, 'b', 18, -4, Math.PI);
      run(s, 45, { ...neutralCommand(), fire: true });
      expect(a.ammo).toBeLessThan(24);
      expect(b.hp).toBe(0);
      expect(s.state.score[0]).toBe(1);
      expect(s.state.reason).toBe('elimination');
    } finally {
      s.dispose();
    }
  });
  it('enforces the magazine, reload interval and head/body hit checks', async () => {
    const s = await duel();
    try {
      const a = place(s, 'a', 18, 8);
      run(s, 35, { ...neutralCommand(), fire: true });
      const used = a.ammo;
      expect(used).toBeLessThan(24);
      run(s, 1, { ...neutralCommand(), reload: true });
      expect(a.reload).toBeGreaterThan(1.8);
      run(s, 60);
      expect(a.ammo).toBe(used);
      run(s, 60);
      expect(a.ammo).toBe(balance.magazine);
    } finally {
      s.dispose();
    }
  });
  it('transforms real module colliders after a visible warning and consumes a charge', async () => {
    const s = await duel();
    try {
      place(s, 'a', -6, 6);
      run(s, 25, { ...neutralCommand(), fold: true, pitch: -0.16 });
      const n = s.state.nodes[0];
      expect(n.phase).toBe('warning');
      expect(n.state).toBe(0);
      run(s, 100);
      expect(n.state).toBe(1);
      expect(n.phase).toBe('idle');
      expect(s.state.players[0].foldCharges).toBe(1);
      expect(n.availableAt).toBeGreaterThan(s.state.tick / 60);
    } finally {
      s.dispose();
    }
  });
  it('refunds and cancels a fold when its swept volume is occupied', async () => {
    const s = await duel();
    try {
      place(s, 'a', -6, 6);
      place(s, 'b', -6, 0);
      run(s, 70, { ...neutralCommand(), fold: true, pitch: -0.16 });
      expect(s.state.nodes[0].state).toBe(0);
      expect(s.state.players[0].foldCharges).toBe(2);
      expect(s.state.events.some((e) => e.type === 'fold-cancel')).toBe(true);
    } finally {
      s.dispose();
    }
  });
  it('opens Core after 45 seconds, pauses contested capture and awards a hold', async () => {
    const s = await duel();
    try {
      run(s, 45 * 60);
      const a = place(s, 'a', 0, 1);
      place(s, 'b', 0, -1);
      run(s, 90);
      expect(a.capture).toBe(0);
      place(s, 'b', 18, 12);
      run(s, 301);
      expect(s.state.reason).toBe('core-override');
      expect(s.state.score[0]).toBe(1);
    } finally {
      s.dispose();
    }
  });
  it('has a finite overtime and a bounded number of rounds instead of an endless stalemate', async () => {
    const s = await duel();
    try {
      run(s, 96 * 60);
      expect(s.state.phase).toBe('round-end');
      expect(s.state.reason).toBe('overtime-verdict');
    } finally {
      s.dispose();
    }
  });
  it('resolves simultaneous lethal shots without granting slot zero priority', async () => {
    const s = await duel();
    try {
      const a = place(s, 'a', 19, 4),
        b = place(s, 'b', 19, -4, Math.PI);
      a.hp = b.hp = 20;
      s.combat.record(s.state);
      run(
        s,
        1,
        { ...neutralCommand(), fire: true },
        { ...neutralCommand(), yaw: Math.PI, fire: true },
      );
      expect(a.hp).toBe(0);
      expect(b.hp).toBe(0);
      expect(s.state.roundWinner).toBeNull();
      expect(s.state.score).toEqual([0, 0]);
    } finally {
      s.dispose();
    }
  });
  it('allows only bounded actor rewind and retains currently closed Fold geometry', async () => {
    const s = await duel();
    try {
      place(s, 'a', 19, 4);
      place(s, 'b', 19, -4, Math.PI);
      s.combat.record(s.state);
      const tick = s.state.tick;
      place(s, 'b', 17, -4, Math.PI);
      const hp = s.state.players[1].hp;
      s.step(new Map([['a', { ...neutralCommand(), fire: true, aimTick: tick }]]));
      expect(s.state.players[1].hp).toBeLessThan(hp);
      const b = place(s, 'b', -5, -4, Math.PI);
      place(s, 'a', -5, 4);
      b.hp = 100;
      s.state.players[0].shot = 0;
      s.state.nodes[0].state = 1;
      s.physics.modulesAt(s.state.nodes);
      s.combat.record(s.state);
      const openTick = s.state.tick;
      s.state.nodes[0].state = 0;
      s.physics.modulesAt(s.state.nodes);
      s.step(new Map([['a', { ...neutralCommand(), fire: true, aimTick: openTick }]]));
      expect(b.hp).toBe(100);
    } finally {
      s.dispose();
    }
  });
});
