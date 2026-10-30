import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { Client, type Room, type SeatReservation } from '@colyseus/sdk';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/password';
import { signConnectionToken } from '../server/token';
import { FORGE_VERSION } from '../src/games/fold/config';
import type { ForgeSnapshot } from '../src/games/fold/contracts';
import { driveDuel, newDuelDriver } from '../tests/helpers/forge-driver';
const internal = process.env.MULTIPLAYER_INTERNAL_URL ?? 'http://localhost:2568',
  endpoint = process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'ws://localhost:2568';
assert(['localhost', '127.0.0.1'].includes(new URL(internal).hostname));
assert(
  /^nexus_gameplay_qa_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1)) ||
    process.env.NEXUS_E2E_DISPOSABLE_DB === '1',
  'Disposable local database only',
);
const ids: string[] = [],
  rooms: Room[] = [],
  timers: ReturnType<typeof setInterval>[] = [],
  delays = new Set<ReturnType<typeof setTimeout>>();
const report = {
  date: new Date().toISOString(),
  passed: false,
  scope:
    'Real SDK clients, signed NEXUS admission, normal inputs only. Application-message delay/loss emulation; not geographic TCP tests.',
  cases: [] as unknown[],
};
async function wait(fn: () => boolean | Promise<boolean>, label: string, timeout = 180000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error('Timeout ' + label);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function control(userId: string, body: unknown, expected = 200) {
  const r = await fetch(internal + '/control', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + signConnectionToken({ sub: userId, ver: 0, kind: 'control' }),
    },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, expected, 'Admission response');
  return r.json();
}
try {
  const game = await db.game.findUniqueOrThrow({ where: { slug: 'fold-zero' } });
  const profiles =
    process.env.NEXUS_TEST_NETWORK === '1'
      ? [
          { rtt: 20, jitter: 0, loss: 0 },
          { rtt: 50, jitter: 0, loss: 0 },
          { rtt: 100, jitter: 0, loss: 0 },
          { rtt: 150, jitter: 15, loss: 0.02 },
        ]
      : [{ rtt: 0, jitter: 0, loss: 0 }];
  await Promise.all(
    profiles.map(async (profile, index) => {
      let seed = 7741 + index;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        return (seed >>> 0) / 4294967296;
      };
      const schedule = (fn: () => void) => {
        const ms = Math.max(0, profile.rtt / 2 + (random() * 2 - 1) * profile.jitter);
        const t = setTimeout(() => {
          delays.delete(t);
          fn();
        }, ms);
        delays.add(t);
      };
      const users = await Promise.all(
        [0, 1].map(async () => {
          const name = 'forgetest_' + randomBytes(6).toString('hex');
          const user = await db.user.create({
            data: {
              username: name,
              email: name + '@example.test',
              passwordHash: await hashPassword(randomBytes(24).toString('hex')),
              settings: { create: {} },
              library: { create: { gameId: game.id } },
            },
          });
          ids.push(user.id);
          return user;
        }),
      );
      type Peer = {
        room: Room;
        snapshot: ForgeSnapshot | null;
        seq: number;
        reconnects: number;
        driver: ReturnType<typeof newDuelDriver>;
        phases: Set<string>;
        folds: Set<string>;
      };
      async function join(i: number, roomId?: string): Promise<Peer> {
        const ticket = await control(
          users[i].id,
          roomId
            ? { action: 'join', gameId: game.id, roomId }
            : { action: 'create', gameId: game.id, private: true, maxPlayers: 2 },
        );
        const room = await new Client(endpoint).consumeSeatReservation(
          ticket.reservation as SeatReservation,
        );
        rooms.push(room);
        room.reconnection.minUptime = 0;
        room.reconnection.maxDelay = 500;
        const p: Peer = {
          room,
          snapshot: null,
          seq: 0,
          reconnects: 0,
          driver: newDuelDriver(),
          phases: new Set(),
          folds: new Set(),
        };
        room.onMessage('snapshot', (s: ForgeSnapshot) =>
          schedule(() => {
            if (p.snapshot && p.snapshot.serverTime > s.serverTime) return;
            p.snapshot = s;
            if (s.game) p.phases.add(s.game.phase);
            for (const n of s.game?.nodes ?? []) if (n.state === 1) p.folds.add(n.id);
          }),
        );
        room.onMessage('notice', () => {});
        room.onMessage('pong', () => {});
        room.onReconnect(() => p.reconnects++);
        await wait(() => !!p.snapshot, 'initial snapshot', 15000);
        return p;
      }
      const a = await join(0);
      // A code or room ID alone cannot bypass private admission.
      await control(users[1].id, { action: 'join', gameId: game.id, roomId: a.room.roomId }, 403);
      const pair = users.map((u) => u.id).sort();
      await db.friendship.create({ data: { userAId: pair[0], userBId: pair[1] } });
      await db.gameInvite.create({
        data: {
          senderId: users[0].id,
          recipientId: users[1].id,
          gameId: game.id,
          kind: 'GAME',
          roomId: a.room.roomId,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      const b = await join(1, a.room.roomId);
      assert.equal(a.room.roomId, b.room.roomId);
      for (const p of [a, b]) p.room.send('ready', { ready: true, protocol: FORGE_VERSION });
      await wait(() => a.snapshot?.players.every((p) => p.ready) === true, 'ready');
      a.room.send('start');
      a.room.send('start');
      for (const [i, p] of [a, b].entries()) {
        const timer = setInterval(() => {
          const state = p.snapshot?.game;
          if (!state || !p.room.connection.isOpen) return;
          const command = {
            ...driveDuel(state, users[i].id, p.driver, i === 0, i === 0),
            seq: p.seq++,
          };
          if (random() < profile.loss) return;
          schedule(() => {
            if (p.room.connection.isOpen) p.room.send('input', command);
          });
        }, 1000 / 60);
        timers.push(timer);
      }
      if (index === 0) {
        await wait(() => !!a.snapshot?.game && a.snapshot.game.round >= 2, 'second round');
        b.room.connection.close(4010, 'QA network interruption');
        await wait(() => b.reconnects === 1, 'same-seat reconnection', 15000);
      }
      await wait(
        () =>
          a.snapshot?.phase === 'results' &&
          a.snapshot.saved &&
          b.snapshot?.phase === 'results' &&
          b.snapshot.saved,
        'settled duel',
      );
      assert.deepEqual(a.snapshot!.game, b.snapshot!.game);
      assert.equal(a.snapshot!.game!.winner, users[0].id);
      assert.equal(a.snapshot!.game!.score[0], 5);
      assert(a.folds.has('shutter') && b.folds.has('shutter'));
      const matchId = a.snapshot!.matchId!;
      const rows = await db.matchParticipant.findMany({
        where: { matchId },
        include: { result: true },
      });
      assert.equal(rows.length, 2);
      assert(rows.every((p) => p.result?.serverVerified && p.result.didFinish));
      assert.equal(
        await db.multiplayerMatch.count({ where: { roomId: a.room.roomId } }),
        1,
        'Duplicate starts must not create two matches',
      );
      a.room.send('rematch');
      await wait(() => a.snapshot?.phase === 'lobby' && b.snapshot?.phase === 'lobby', 'rematch');
      report.cases.push({
        profile,
        independentClients: 2,
        score: [5, 0],
        rounds: 5,
        serverVerifiedResults: 2,
        foldSynchronized: true,
        resultsAgreed: true,
        reconnections: b.reconnects,
        duplicateStartBlocked: true,
        privateAdmissionBlocked: true,
        rematch: true,
      });
      console.log(JSON.stringify({ passedProfile: profile.rtt }));
      await a.room.leave(true);
      await b.room.leave(true);
    }),
  );
  report.passed = true;
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      error: error instanceof Error ? error.name : 'Unknown',
      reason: error instanceof Error ? error.message : 'Unknown',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const timer of timers) clearInterval(timer);
  for (const timer of delays) clearTimeout(timer);
  for (const room of rooms) {
    room.reconnection.enabled = false;
    if (room.connection.isOpen) await room.leave(true).catch(() => {});
  }
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'forgetest_' } } });
  await db.$disconnect();
  await fs.mkdir('docs/fold-zero', { recursive: true });
  await fs.mkdir('docs/fold-controls', { recursive: true });
  await fs.writeFile('docs/fold-controls/network.json', JSON.stringify(report, null, 2) + '\n');
}
