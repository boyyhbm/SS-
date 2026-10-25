import { afterEach, describe, expect, it, vi } from 'vitest';
import { signConnectionToken, verifyConnectionToken } from '../server/token';
import {
  inputCommandSchema,
  type NetworkPlayer,
  type RoomSnapshot,
} from '../src/multiplayer/contracts';
import { RacePrediction } from '../src/multiplayer/prediction';
import { initialRace } from '../src/games/racing-physics';
const player = (id: string, x = 95): NetworkPlayer => ({
  id,
  username: id,
  avatar: 'cyan',
  car: 'cyan',
  ready: true,
  connected: true,
  state: { ...initialRace(), x },
  ack: -1,
  finish: null,
  place: null,
});
const snapshot = (
  serverTime: number,
  players = [player('local'), player('remote')],
): RoomSnapshot => ({
  roomId: 'room',
  code: 'AABBCC',
  gameId: 'game',
  leaderId: 'local',
  phase: 'racing',
  region: 'europe',
  mode: 'circuit',
  private: true,
  maxPlayers: 6,
  laps: 1,
  serverTime,
  tick: 1,
  startsAt: 0,
  matchId: 'match',
  saved: false,
  players,
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('multiplayer trust boundary', () => {
  it('authenticates short-lived audience-scoped signatures and rejects tampering', () => {
    vi.stubEnv('MULTIPLAYER_SECRET', 'f'.repeat(96));
    const token = signConnectionToken({ sub: 'user', ver: 3, kind: 'seat', roomId: 'room' }, 1000);
    expect(verifyConnectionToken(token, 'seat', 1001).sub).toBe('user');
    expect(() => verifyConnectionToken(`${token.slice(0, -4)}xxxx`, 'seat', 1001)).toThrow();
    expect(() => verifyConnectionToken(token, 'control', 1001)).toThrow();
    expect(() => verifyConnectionToken(token, 'seat', 46000)).toThrow();
    expect(() => verifyConnectionToken(token, 'seat', -2000)).toThrow();
  });
  it('accepts only bounded input, never position, speed, duration or results', () => {
    const input = { seq: 1, throttle: 1, brake: 0, steer: 0.2, nitro: false };
    expect(inputCommandSchema.safeParse(input).success).toBe(true);
    for (const extra of [
      { speed: 900 },
      { x: 0 },
      { dt: 10 },
      { winner: true },
      { nitro: 999 },
      { steer: 2 },
      { throttle: NaN },
    ])
      expect(inputCommandSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
});
describe('prediction and interpolation', () => {
  it('responds locally before a server reply and reconciles unacknowledged commands', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const commands: unknown[] = [];
    const p = new RacePrediction('local', (input) => commands.push(input));
    p.receive(snapshot(1000));
    p.frame({ throttle: 1, brake: 0, steer: 0, nitro: false }, 1 / 30);
    expect(p.state.speed).toBeGreaterThan(0);
    expect(commands).toHaveLength(1);
    const state = snapshot(1033);
    state.players[0].ack = -1;
    p.receive(state);
    expect(p.state.speed).toBeGreaterThan(0);
    expect(p.pending).toHaveLength(1);
    state.serverTime = 1066;
    state.players[0].ack = 0;
    p.receive(state);
    expect(p.pending).toHaveLength(0);
  });
  it('interpolates wrapped angles and caps extrapolation to 100 ms', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const p = new RacePrediction('local', () => {});
    const a = snapshot(1000);
    a.players[1].state.heading = Math.PI - 0.1;
    a.players[1].state.vx = 10;
    p.receive(a);
    now = 1100;
    const b = snapshot(1100, [player('local'), player('remote', 105)]);
    b.players[1].state.heading = -Math.PI + 0.1;
    b.players[1].state.vx = 10;
    p.receive(b);
    now = 1170;
    const mid = p.remotePlayers()[0].state;
    expect(mid.x).toBeCloseTo(100);
    expect(Math.abs(mid.heading)).toBeCloseTo(Math.PI);
    now = 10000;
    expect(p.remotePlayers()[0].state.x).toBeCloseTo(106);
  });
  it('ignores stale snapshots and stops prediction during reconnection', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const p = new RacePrediction('local', () => {});
    p.receive(snapshot(1100));
    p.receive(snapshot(1000, [player('local', 0)]));
    expect(p.state.x).toBe(95);
    p.connected = false;
    p.frame({ throttle: 1, brake: 0, steer: 0, nitro: false }, 0.05);
    expect(p.state.speed).toBe(0);
  });
});

describe('server-derived presence', () => {
  it('expires heartbeats and derives away from inactivity', async () => {
    const { online, presence } = await import('../server/state');
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    online.set('presence-test', { seen: now, active: now });
    expect(presence('presence-test').status).toBe('online');
    now = 42000;
    expect(presence('presence-test').status).toBe('offline');
    online.set('presence-test', { seen: 122000, active: 1000 });
    now = 123000;
    expect(presence('presence-test').status).toBe('away');
    online.delete('presence-test');
  });
  it('never accepts a client-selected presence status', async () => {
    const { multiplayerActionSchema } = await import('../src/multiplayer/contracts');
    expect(
      multiplayerActionSchema.safeParse({ action: 'heartbeat', status: 'inGame', userId: 'victim' })
        .success,
    ).toBe(false);
  });
});

describe('friend lobby discovery', () => {
  it('offers direct joining only for public lobbies', async () => {
    const { liveRooms, presence } = await import('../server/state');
    const room = {
      roomId: 'private-unit-room',
      gameId: 'game',
      code: 'AABBCC',
      leaderId: 'friend',
      phase: 'lobby' as const,
      privateRoom: true,
      maxClients: 6,
      players: new Map([['friend', { id: 'friend', connected: true }]]),
      admitted: new Set(['friend']),
      pendingSeats: new Map<string, number>(),
      heldIds: () => [],
      occupancy: () => 1,
      seatToken: () => '',
    };
    liveRooms.set(room.roomId, room);
    try {
      expect(presence('friend').joinable).toBe(false);
      room.privateRoom = false;
      expect(presence('friend').joinable).toBe(true);
    } finally {
      liveRooms.delete(room.roomId);
    }
  });
});

it('reconciles local yaw over the short arc instead of snapping rotation at each snapshot', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const p = new RacePrediction('local', () => {});
  const first = snapshot(1000);
  first.players[0].state.heading = Math.PI - 0.05;
  p.receive(first);
  const next = snapshot(1034);
  next.players[0].state.heading = -Math.PI + 0.15;
  p.receive(next);
  const visual = p.frame({ throttle: 0, brake: 0, steer: 0, nitro: false }, 1 / 120);
  expect(
    Math.abs(
      Math.atan2(
        Math.sin(visual.heading - (Math.PI - 0.05)),
        Math.cos(visual.heading - (Math.PI - 0.05)),
      ),
    ),
  ).toBeLessThan(0.04);
  expect(p.state.heading).toBeCloseTo(-Math.PI + 0.15);
});
