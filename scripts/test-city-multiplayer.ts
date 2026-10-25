// Genuine SDK clients against the isolated local server; never inject poses/results.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { Client, type Room, type SeatReservation } from '@colyseus/sdk';
import { db } from '../src/lib/db';
import { signConnectionToken } from '../server/token';
import { hashPassword } from '../src/lib/password';
import { RacePrediction } from '../src/multiplayer/prediction';
import type { RoomSnapshot } from '../src/multiplayer/contracts';
import { cityRoutes } from '../src/games/road-network';
import { routeDriver } from '../tests/helpers/city-driver';
import { compatibleRoute } from '../src/games/route-registry';
const internal = process.env.MULTIPLAYER_INTERNAL_URL ?? 'http://localhost:2568';
const endpoint = process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'ws://localhost:2568';
if (
  !/^nexus_gameplay_qa_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1)) ||
  !['localhost', '127.0.0.1'].includes(new URL(internal).hostname)
)
  throw Error('Isolated local city QA only');
const contactMode = process.env.NEXUS_TEST_CONTACTS === '1';
const faultMode = process.env.NEXUS_TEST_NETWORK === '1';
const delayed = new Set<ReturnType<typeof setTimeout>>();
const ids: string[] = [],
  rooms: Room[] = [],
  timers: ReturnType<typeof setInterval>[] = [];
const wait = async (fn: () => boolean | Promise<boolean>, label: string, timeout = 180000) => {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error('Timeout ' + label);
    await new Promise((r) => setTimeout(r, 30));
  }
};
const report: { date: string; passed: boolean; routes: unknown[]; error?: string } = {
  date: new Date().toISOString(),
  passed: false,
  routes: [],
};
async function control(id: string, body: unknown) {
  const r = await fetch(internal + '/control', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + signConnectionToken({ sub: id, ver: 0, kind: 'control' }),
    },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  return r.json();
}
try {
  const game = await db.game.findUniqueOrThrow({ where: { slug: 'midnight-outlaws' } });
  const runs = await Promise.allSettled(
    cityRoutes.map(async (route, routeIndex) => {
      const profile = faultMode
        ? [
            { rtt: 50, jitter: 0, loss: 0 },
            { rtt: 100, jitter: 10, loss: 0 },
            { rtt: 200, jitter: 20, loss: 0.02 },
          ][routeIndex]
        : { rtt: 0, jitter: 0, loss: 0 };
      let seed = 8041 + routeIndex;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        return (seed >>> 0) / 4294967296;
      };
      const schedule = (fn: () => void) => {
        const delay = Math.max(0, profile.rtt / 2 + (random() * 2 - 1) * profile.jitter);
        if (!delay) {
          fn();
          return;
        }
        const t = setTimeout(() => {
          delayed.delete(t);
          fn();
        }, delay);
        delayed.add(t);
      };
      const users = await Promise.all(
        [0, 1].map(async () => {
          const name = 'citynet_' + randomBytes(7).toString('hex');
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
      const aId = users.map((u) => u.id).sort();
      await db.friendship.create({ data: { userAId: aId[0], userBId: aId[1] } });
      type Peer = {
        room: Room;
        snapshot: RoomSnapshot | null;
        prediction: RacePrediction;
        reconnects: number;
        errors: number[];
      };
      async function connect(i: number, roomId?: string): Promise<Peer> {
        const ticket = await control(
          users[i].id,
          roomId
            ? { action: 'join', gameId: game.id, roomId }
            : {
                action: 'create',
                gameId: game.id,
                routeId: route.id,
                private: true,
                maxPlayers: 2,
                carContacts: contactMode,
              },
        );
        const room = await new Client(endpoint).consumeSeatReservation(
          ticket.reservation as SeatReservation,
        );
        rooms.push(room);
        const peer: Peer = {
          room,
          snapshot: null,
          reconnects: 0,
          errors: [],
          prediction: new RacePrediction(users[i].id, (input) => {
            if (random() < profile.loss) return;
            schedule(() => {
              if (room.connection.isOpen) room.send('input', input);
            });
          }),
        };
        room.reconnection.minUptime = 0;
        room.onMessage('snapshot', (snapshot: RoomSnapshot) =>
          schedule(() => {
            if (peer.snapshot && peer.snapshot.serverTime > snapshot.serverTime) return;
            assert.ok(snapshot.route && compatibleRoute(snapshot.route));
            peer.snapshot = snapshot;
            peer.prediction.receive(snapshot);
            if (snapshot.phase === 'racing') peer.errors.push(peer.prediction.lastError);
          }),
        );
        room.onMessage('event', () => {});
        room.onMessage('notice', () => {});
        room.onMessage('pong', () => {});
        room.onDrop(() => {
          peer.prediction.connected = false;
        });
        room.onReconnect(() => {
          peer.reconnects++;
          peer.prediction.connected = true;
          peer.prediction.resetPending();
        });
        await wait(() => !!peer.snapshot, 'initial snapshot');
        return peer;
      }
      const a = await connect(0);
      await db.gameInvite.create({
        data: {
          senderId: users[0].id,
          recipientId: users[1].id,
          gameId: game.id,
          roomId: a.room.roomId,
          kind: 'GAME',
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const b = await connect(1, a.room.roomId);
      await wait(
        () => a.snapshot?.players.length === 2 && b.snapshot?.players.length === 2,
        'two clients',
      );
      assert.notDeepEqual(a.snapshot!.players[0].state, a.snapshot!.players[1].state);
      a.room.send('settings', { routeId: route.id, laps: 1, carContacts: contactMode });
      await wait(
        () => a.snapshot?.laps === 1 && b.snapshot?.route?.routeId === route.id,
        'route config',
      );
      for (const p of [a, b]) p.room.send('ready', true);
      await wait(() => a.snapshot!.players.every((p) => p.ready), 'ready');
      a.room.send('start');
      a.room.send('start');
      const raceTimers = [a, b].map((p) =>
        setInterval(() => {
          if (p.room.connection.isOpen)
            p.prediction.frame(routeDriver(route, p.prediction.state), 1 / 30);
        }, 1000 / 30),
      );
      timers.push(...raceTimers);
      await wait(() => a.snapshot?.phase === 'racing' && b.snapshot?.phase === 'racing', 'start');
      assert.equal(a.snapshot!.startsAt, b.snapshot!.startsAt);
      assert.equal(a.snapshot!.matchId, b.snapshot!.matchId);
      if (faultMode && route.id === 'industrial-run') {
        await wait(() => !!a.snapshot && a.snapshot.tick > 180, 'race before reconnect');
        b.room.connection.close(4010, 'Temporary QA disconnect');
        await wait(() => b.reconnects > 0, 'reconnection', 15000);
      }
      await wait(() => a.snapshot?.saved === true && b.snapshot?.saved === true, 'results');
      raceTimers.forEach(clearInterval);
      assert.ok(a.snapshot!.players.every((p) => p.finish !== null));
      const results = (p: Peer) =>
        p.snapshot!.players.map((x) => ({ id: x.id, finish: x.finish, place: x.place }));
      assert.deepEqual(results(a), results(b));
      const match = await db.multiplayerMatch.findUniqueOrThrow({
        where: { id: a.snapshot!.matchId! },
        include: { participants: { include: { result: true } } },
      });
      assert.equal(match.routeId, route.id);
      assert.equal(match.routeVersion, a.snapshot!.route!.routeVersion);
      assert.equal(match.laps, 1);
      assert.equal(match.carContacts, contactMode);
      const verifiedContactEvents = a.snapshot!.contactEvents ?? 0;
      if (contactMode)
        assert.ok(verifiedContactEvents > 0, 'actual authoritative car contacts must occur');
      assert.ok(match.participants.every((p) => p.result?.serverVerified && p.result.didFinish));
      const verifiedResults = results(a);
      a.room.send('rematch');
      await wait(() => a.snapshot?.phase === 'lobby' && b.snapshot?.phase === 'lobby', 'rematch');
      report.routes.push({
        routeId: route.id,
        routeVersion: match.routeVersion,
        carContacts: contactMode,
        networkSimulation: profile,
        simulationScope:
          'Application-message delay/jitter/drop, not a geographic WAN or TCP loss benchmark',
        reconnects: b.reconnects,
        reconciliationErrorP95Meters:
          [...a.errors, ...b.errors].sort((a, b) => a - b)[
            Math.max(0, Math.ceil((a.errors.length + b.errors.length) * 0.95) - 1)
          ] ?? null,
        contactEvents: verifiedContactEvents,
        mode: route.kind,
        players: 2,
        serverFinishSeconds: verifiedResults,
        startsAtAgreed: true,
        resultsAgreed: true,
        savedToPostgres: true,
        rematch: true,
      });
      for (const p of [a, b]) {
        p.room.reconnection.enabled = false;
        await p.room.leave(true);
      }
    }),
  );
  const failures = runs.filter((r) => r.status === 'rejected');
  if (failures.length)
    throw Error(failures.map((r) => String((r as PromiseRejectedResult).reason)).join('; '));
  report.passed = true;
} catch (e) {
  report.error = e instanceof Error ? e.message : 'Unknown failure';
  process.exitCode = 1;
} finally {
  timers.forEach(clearInterval);
  delayed.forEach(clearTimeout);
  for (const r of rooms) {
    r.reconnection.enabled = false;
    if (r.connection.isOpen) await r.leave(true).catch(() => {});
  }
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'citynet_' } } });
  await db.$disconnect();
  await mkdir('docs/gameplay-update', { recursive: true });
  await writeFile(
    'docs/gameplay-update/' + (contactMode ? 'private-contacts.json' : 'multiplayer-routes.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      routes: report.routes.length,
      ...(report.error ? { error: report.error } : {}),
    }),
  );
}
