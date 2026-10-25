import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Client, type Room, type SeatReservation } from '@colyseus/sdk';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/password';
import { signConnectionToken } from '../server/token';
import { RacePrediction } from '../src/multiplayer/prediction';
import { FIXED_DT, type InputCommand, type RoomSnapshot } from '../src/multiplayer/contracts';
const prefix = `net_${randomBytes(6).toString('hex')}`;
const internal = process.env.MULTIPLAYER_INTERNAL_URL ?? 'http://127.0.0.1:2567';
const websocket = process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'ws://localhost:2567';
const clients: Room[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
const delayed = new Set<ReturnType<typeof setTimeout>>();
const checks: string[] = [];
const observations: Record<string, unknown>[] = [];
const userIds: string[] = [];
const waitFor = async (fn: () => boolean | Promise<boolean>, label: string, timeout = 12000) => {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
async function control(userId: string, body: Record<string, unknown>, expected = 200) {
  const res = await fetch(`${internal}/control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signConnectionToken({ sub: userId, ver: 0, kind: 'control' })}`,
    },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, expected, `control ${body.action}`);
  return res.json();
}
interface TestPeer {
  room: Room;
  prediction: RacePrediction;
  snapshot: RoomSnapshot | null;
  profile: { delay: number; jitter: number; loss: number };
  sent: number;
  dropped: number;
  rtts: number[];
  errors: number[];
}
function schedule(fn: () => void, profile: TestPeer['profile']) {
  const milliseconds = Math.max(0, profile.delay + (Math.random() * 2 - 1) * profile.jitter);
  if (!milliseconds) {
    fn();
    return;
  }
  const timer = setTimeout(() => {
    delayed.delete(timer);
    fn();
  }, milliseconds);
  delayed.add(timer);
}
async function connect(userId: string, body: Record<string, unknown>): Promise<TestPeer> {
  const ticket = await control(userId, body);
  const room = await new Client(websocket).consumeSeatReservation(
    ticket.reservation as SeatReservation,
  );
  clients.push(room);
  room.reconnection.minUptime = 0;
  room.reconnection.maxDelay = 500;
  const peer = {
    room,
    snapshot: null,
    profile: { delay: 0, jitter: 0, loss: 0 },
    sent: 0,
    dropped: 0,
    rtts: [],
    errors: [],
  } as unknown as TestPeer;
  peer.prediction = new RacePrediction(userId, (input: InputCommand) => {
    peer.sent++;
    if (Math.random() < peer.profile.loss) {
      peer.dropped++;
      return;
    }
    schedule(() => {
      if (room.connection.isOpen) room.send('input', input);
    }, peer.profile);
  });
  room.onMessage('snapshot', (snapshot: RoomSnapshot) => {
    schedule(() => {
      if (peer.snapshot && peer.snapshot.serverTime >= snapshot.serverTime) return;
      peer.snapshot = snapshot;
      peer.prediction.receive(snapshot);
      peer.errors.push(peer.prediction.lastError);
    }, peer.profile);
  });
  room.onMessage('event', () => {});
  room.onMessage('notice', () => {});
  room.onMessage('pong', (data: { echo: number; serverTime: number }) => {
    schedule(() => {
      peer.rtts.push(Date.now() - data.echo);
      peer.prediction.offset = data.serverTime - (data.echo + Date.now()) / 2;
    }, peer.profile);
  });
  room.onDrop(() => {
    peer.prediction.connected = false;
  });
  room.onReconnect(() => {
    peer.prediction.connected = true;
    peer.prediction.pending = [];
  });
  await waitFor(() => !!peer.snapshot, 'first snapshot');
  return peer;
}
function drive(peer: TestPeer) {
  const timer = setInterval(() => {
    if (!peer.room.connection.isOpen) return;
    const state = peer.prediction.state;
    const angle = Math.atan2(state.z, state.x),
      desired = -angle;
    const error = Math.atan2(Math.sin(desired - state.heading), Math.cos(desired - state.heading));
    const radial = Math.hypot(state.x, state.z) - 95;
    const steer = Math.max(
      -1,
      Math.min(1, -error * 2.8 + radial * 0.09 + state.speed / (95 * 1.12)),
    );
    peer.prediction.frame({ throttle: 1, brake: 0, steer, nitro: false }, FIXED_DT);
  }, 1000 / 30);
  timers.push(timer);
}
async function race(a: TestPeer, b: TestPeer, delay: number, jitter = 0, loss = 0) {
  const profile = { delay: delay / 2, jitter, loss };
  a.profile = b.profile = profile;
  a.errors = [];
  b.errors = [];
  a.rtts = [];
  b.rtts = [];
  const previousMatch = a.snapshot?.matchId;
  a.room.send('ready', true);
  b.room.send('ready', true);
  await waitFor(() => a.snapshot?.players.every((p) => p.ready) === true, 'both ready');
  a.room.send('start');
  a.room.send('start'); // concurrent duplicate Start must settle once
  await waitFor(
    () => a.snapshot?.phase === 'racing' && b.snapshot?.phase === 'racing',
    'synchronized start',
  );
  assert.equal(a.snapshot!.matchId, b.snapshot!.matchId);
  assert.equal(a.snapshot!.startsAt, b.snapshot!.startsAt);
  assert.notEqual(a.snapshot!.matchId, previousMatch);
  const initialX = b.snapshot!.players[0].state.x;
  await waitFor(() => Math.abs(b.snapshot!.players[0].state.x - initialX) > 2, 'remote movement');
  const pingTimer = setInterval(() => {
    for (const peer of [a, b])
      schedule(() => {
        if (peer.room.connection.isOpen) peer.room.send('ping', Date.now() - peer.profile.delay);
      }, peer.profile);
  }, 500);
  timers.push(pingTimer);
  const started = Date.now();
  await waitFor(
    () =>
      a.snapshot?.phase === 'results' &&
      b.snapshot?.phase === 'results' &&
      a.snapshot.saved &&
      b.snapshot.saved,
    'server verified finish',
    140000,
  );
  clearInterval(pingTimer);
  assert(
    a.snapshot!.players.every((p) => p.finish !== null),
    'both drivers must actually finish',
  );
  assert.deepEqual(
    a.snapshot!.players.map((p) => [p.id, p.finish, p.place]),
    b.snapshot!.players.map((p) => [p.id, p.finish, p.place]),
  );
  const match = await db.multiplayerMatch.findUniqueOrThrow({
    where: { id: a.snapshot!.matchId! },
    include: { participants: { include: { result: true } } },
  });
  assert.equal(match.status, 'FINISHED');
  assert.equal(match.participants.length, 2);
  assert(match.participants.every((p) => p.result?.serverVerified && p.result.didFinish));
  assert.equal(
    await db.multiplayerMatch.count({ where: { roomId: a.room.roomId, status: 'FINISHED' } }),
    observations.filter((o) => o.kind === 'race').length + 1,
  );
  const errors = [...a.errors, ...b.errors].sort((x, y) => x - y);
  const rtts = [...a.rtts, ...b.rtts].sort((x, y) => x - y);
  observations.push({
    kind: 'race',
    configuredRttMs: delay,
    configuredOneWayJitterMs: jitter,
    inputDropFraction: loss,
    elapsedWallMs: Date.now() - started,
    serverFinishSeconds: a.snapshot!.players.map((p) => p.finish),
    actualRttMedianMs: rtts[Math.floor(rtts.length / 2)],
    reconciliationErrorP95Meters: errors[Math.floor(errors.length * 0.95)],
    commandsSent: a.sent + b.sent,
    commandsDropped: a.dropped + b.dropped,
  });
  checks.push(
    `Two independent accounts/SDK sessions: ready, shared start, movement, finish, DB settlement, duplicate Start; RTT ${delay}ms`,
  );
}
try {
  const passwordHash = await hashPassword('Nexus independent test accounts 2026');
  for (let i = 0; i < 19; i++) {
    const user = await db.user.create({
      data: {
        username: `${prefix}_${i}`,
        email: `${prefix}_${i}@example.test`,
        passwordHash,
        role: i === 0 ? 'ADMIN' : 'USER',
        settings: { create: {} },
      },
    });
    userIds.push(user.id);
  }
  for (const peer of [1, 2]) {
    const [userAId, userBId] = [userIds[0], userIds[peer]].sort();
    await db.friendship.create({ data: { userAId, userBId } });
  }
  const game = await db.game.findUniqueOrThrow({ where: { slug: 'midnight-outlaws' } });
  await db.userLibrary.createMany({ data: userIds.map((userId) => ({ userId, gameId: game.id })) });
  assert.equal(
    (
      await fetch(`${internal}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"action":"status"}',
      })
    ).status,
    403,
  );
  await assert.rejects(new Client(websocket).create('nexus_race', {}));
  checks.push('Unauthenticated control and direct Colyseus create rejected');
  const a = await connect(userIds[0], {
    action: 'create',
    gameId: game.id,
    private: true,
    maxPlayers: 2,
  });
  await control(userIds[1], { action: 'join', gameId: game.id, roomId: a.room.roomId }, 403);
  await assert.rejects(new Client(websocket).joinById(a.room.roomId, {}));
  checks.push('Private room access and unauthenticated seat reservation rejected');
  await db.gameInvite.create({
    data: {
      senderId: userIds[0],
      recipientId: userIds[1],
      kind: 'GAME',
      gameId: game.id,
      roomId: a.room.roomId,
      expiresAt: new Date(Date.now() + 300000),
    },
  });
  const b = await connect(userIds[1], { action: 'join', gameId: game.id, roomId: a.room.roomId });
  await waitFor(
    () => a.snapshot?.players.length === 2 && b.snapshot?.players.length === 2,
    'mutual lobby roster',
  );
  await db.gameInvite.create({
    data: {
      senderId: userIds[0],
      recipientId: userIds[2],
      kind: 'GAME',
      gameId: game.id,
      roomId: a.room.roomId,
      expiresAt: new Date(Date.now() + 300000),
    },
  });
  await control(userIds[2], { action: 'join', gameId: game.id, roomId: a.room.roomId }, 403);
  checks.push('Capacity 2 enforced against a third invited account');
  a.room.send('input', {
    seq: 0,
    throttle: 1,
    brake: 0,
    steer: 0,
    nitro: false,
    speed: 9999,
    x: 0,
  });
  drive(a);
  drive(b);
  await race(a, b, 50);
  a.room.send('rematch');
  await waitFor(
    () => a.snapshot?.phase === 'lobby' && b.snapshot?.phase === 'lobby',
    'rematch lobby',
  );
  let drops = 0,
    reconnects = 0;
  b.room.onDrop(() => drops++);
  b.room.onReconnect(() => reconnects++);
  b.room.connection.close(4010, 'Network interruption test');
  await waitFor(() => reconnects === 1, 'reconnection');
  assert.equal(drops, 1);
  checks.push('Real WebSocket disconnection and same-seat automatic reconnection');
  await race(a, b, 100, 10);
  a.room.send('rematch');
  await waitFor(
    () => a.snapshot?.phase === 'lobby' && b.snapshot?.phase === 'lobby',
    'second rematch',
  );
  await race(a, b, 200, 20, 0.03);
  await a.room.leave();
  await b.room.leave();
  // Concurrent searches must share a public room and never allocate over six seats.
  const publicPeers = await Promise.all(
    [2, 3, 4, 5, 6, 7].map((i) => connect(userIds[i], { action: 'quick', gameId: game.id })),
  );
  assert.equal(new Set(publicPeers.map((p) => p.room.roomId)).size, 1);
  await waitFor(
    () => publicPeers.every((p) => p.snapshot?.players.length === 6),
    'six player matchmaking',
  );
  checks.push('Six simultaneous Quick Match requests resolve to the same capacity-limited room');
  for (const peer of publicPeers) await peer.room.leave();
  // Small reproducible load probe; records actual measurements, never a capacity claim.
  const loadPeers: TestPeer[] = [];
  const loadStarted = Date.now();
  for (let i = 0; i < 6; i++) {
    const first = await connect(userIds[i * 2 + 2], {
      action: 'create',
      gameId: game.id,
      private: false,
      maxPlayers: 2,
    });
    const second = await connect(userIds[i * 2 + 3], {
      action: 'join',
      gameId: game.id,
      roomId: first.room.roomId,
    });
    loadPeers.push(first, second);
    drive(first);
    drive(second);
    first.room.send('ready', true);
    second.room.send('ready', true);
    await waitFor(() => first.snapshot?.players.every((p) => p.ready) === true, 'load ready');
    first.room.send('start');
  }
  await waitFor(async () => {
    const m = await control(userIds[0], { action: 'metrics' });
    return m.concurrentMatches === 6;
  }, 'six parallel races');
  const before = await control(userIds[0], { action: 'metrics' });
  await waitFor(() => Date.now() - loadStarted > 16000, 'load observation interval', 20000);
  const after = await control(userIds[0], { action: 'metrics' });
  observations.push({
    kind: 'load',
    rooms: 6,
    clients: 12,
    observationMs: Date.now() - loadStarted,
    messages: after.messages - before.messages,
    ticks: after.ticks - before.ticks,
    processLifetimeAverageSimulationTickMs: after.averageTickMs,
    processLifetimeMaxSimulationTickMs: after.tickMaxMs,
    disconnects: after.disconnects,
    reconnects: after.reconnects,
  });
  checks.push('Six concurrent authoritative rooms with twelve genuine SDK connections');
  const report = {
    date: new Date().toISOString(),
    transport:
      process.env.TEST_TRANSPORT ??
      'WebSocket on loopback; delay/jitter/drop injected at application message boundaries, not WAN/TCP packet-loss measurements',
    simulationHz: 30,
    snapshotHz: 15,
    checks,
    observations,
  };
  await writeFile('docs/multiplayer-test-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  timers.forEach(clearInterval);
  delayed.forEach(clearTimeout);
  await Promise.allSettled(
    clients.filter((room) => room.connection.isOpen).map((room) => room.leave()),
  );
  if (userIds.length) {
    await db.multiplayerMatch.deleteMany({
      where: { participants: { some: { userId: { in: userIds } } } },
    });
    await db.user.deleteMany({ where: { id: { in: userIds }, email: { startsWith: prefix } } });
  }
  await db.$disconnect();
}
