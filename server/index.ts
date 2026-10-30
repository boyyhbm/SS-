import 'dotenv/config';
import express from 'express';
import { undergroundStatic } from './underground-static';
import { selectRoute } from '../src/games/route-registry';
import { randomUUID } from 'node:crypto';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { db } from '../src/lib/db';
import { multiplayerActionSchema } from '../src/multiplayer/contracts';
import { gameServerAdapter, registeredGameServers } from './registry';
import { liveRooms, metrics, online, partyRooms, presence, publicRooms } from './state';
import { signConnectionToken, verifyConnectionToken } from './token';
import { GameServerOwnership } from './ownership';
const allowedOrigin = new URL(process.env.NEXTAUTH_URL ?? 'http://localhost:3000').origin;
const endpoint = new URL(process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'ws://localhost:2567');
if (
  process.env.NODE_ENV === 'production' &&
  endpoint.protocol !== 'wss:' &&
  !(
    ['localhost', '127.0.0.1'].includes(endpoint.hostname) &&
    ['localhost', '127.0.0.1'].includes(new URL(allowedOrigin).hostname)
  )
)
  throw new Error('Production multiplayer requires WSS');
// Validate the shared secret at startup, without logging it.
signConnectionToken({ sub: 'startup', ver: 0, kind: 'control' });
let ready = false;
const instanceId = randomUUID();
let stopping = false;
const cancellation = new AbortController();
const ownership = new GameServerOwnership(process.env.DATABASE_URL, () => {
  // Losing the fencing connection must stop simulation immediately, before another
  // process can become authoritative. Recovery happens on the next healthy boot.
  ready = false;
  console.error('Game server ownership connection lost');
  process.exit(1);
});
await ownership.connect();
matchMaker.controller.DEFAULT_CORS_HEADERS['Access-Control-Allow-Origin'] = allowedOrigin;
matchMaker.controller.getCorsHeaders = () => ({ 'Access-Control-Allow-Origin': allowedOrigin });
const usedTokens = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of usedTokens) if (expires < now) usedTokens.delete(key);
  for (const [key, value] of online) if (now - value.seen > 180000) online.delete(key);
  for (const [key, roomId] of partyRooms) if (!liveRooms.has(roomId)) partyRooms.delete(key);
}, 30000).unref();
let allocation = Promise.resolve();
async function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const previous = allocation;
  let release!: () => void;
  allocation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
const gameServer = new Server({
  greet: false,
  gracefullyShutdown: false,
  transport: new WebSocketTransport({
    maxPayload: 2048,
    pingInterval: 3000,
    pingMaxRetries: 2,
    beforeUpgrade: (_request, context) => {
      if (!ready) return new Response('Unavailable', { status: 503 });
      const origin = context.headers.get('origin');
      // Native SDK clients may omit Origin, but must still present a valid seat reservation.
      if (origin && origin !== allowedOrigin) return new Response('Forbidden', { status: 403 });
    },
  }),
  express(app) {
    app.disable('x-powered-by');
    app.use('/nfsu', undergroundStatic(allowedOrigin));
    app.use((req, res, next) => {
      const origin = req.get('origin');
      if (origin && origin !== allowedOrigin) return void res.status(403).end();
      res.setHeader('Vary', 'Origin');
      next();
    });
    // /live allows Railway to terminate the old deployment and release its lease.
    // /health is actual readiness; monitors and acceptance tests use this endpoint.
    app.get('/live', (_req, res) =>
      res.json({ ok: !stopping, ready, service: 'nexus-multiplayer' }),
    );
    app.get('/health', async (_req, res) => {
      try {
        if (!ready) throw Error();
        await db.$queryRaw`SELECT 1`;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, region: 'europe', protocol: 1, instanceId });
      } catch {
        res.status(503).json({ ok: false, region: 'europe', protocol: 1 });
      }
    });
    app.post('/control', express.json({ limit: '4kb' }), async (req, res) => {
      if (!ready) return void res.status(503).json({ error: 'networkUnavailable' });
      try {
        const claims = verifyConnectionToken(
          req.headers.authorization?.replace(/^Bearer /, ''),
          'control',
        );
        if (usedTokens.has(claims.jti)) throw new Error('Unauthorized');
        usedTokens.set(claims.jti, claims.exp);
        const user = await db.user.findUnique({
          where: { id: claims.sub },
          select: { id: true, tokenVersion: true, role: true },
        });
        if (!user || user.tokenVersion !== claims.ver) throw new Error('Unauthorized');
        if (req.body.action === 'metrics') {
          if (user.role !== 'ADMIN') return void res.status(403).json({ error: 'requestRejected' });
          return void res.json({
            ...metrics,
            activePlayers: [...liveRooms.values()].reduce(
              (n, r) => n + [...r.players.values()].filter((p) => p.connected).length,
              0,
            ),
            activeRooms: liveRooms.size,
            concurrentMatches: [...liveRooms.values()].filter(
              (r) => r.phase === 'racing' || r.phase === 'countdown',
            ).length,
            messageThroughput:
              metrics.messages / Math.max(1, (Date.now() - metrics.startedAt) / 1000),
            disconnectRatePerMinute:
              metrics.disconnects / Math.max(1, (Date.now() - metrics.startedAt) / 60000),
            reconnectSuccessRate: metrics.disconnects
              ? metrics.reconnects / metrics.disconnects
              : null,
            averageTickMs: metrics.ticks ? metrics.tickTotalMs / metrics.ticks : 0,
          });
        }
        const body = multiplayerActionSchema.parse(req.body);
        if (body.action === 'heartbeat') {
          const previous = online.get(user.id);
          online.set(user.id, {
            seen: Date.now(),
            active: body.activity || !previous ? Date.now() : previous.active,
          });
          return void res.json({ ok: true });
        }
        if (body.action === 'status') {
          const links = await db.friendship.findMany({
            where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
            include: {
              userA: { select: { id: true, settings: true } },
              userB: { select: { id: true, settings: true } },
            },
          });
          const peers = links.map((link) =>
            link.userAId === user.id ? link.userBId : link.userAId,
          );
          const singlePlayerSessions = await db.gameSession.findMany({
            where: {
              userId: { in: peers },
              endedAt: null,
              isPaused: false,
              lastHeartbeatAt: { gt: new Date(Date.now() - 40000) },
            },
            orderBy: { lastHeartbeatAt: 'desc' },
            distinct: ['userId'],
            select: { userId: true, gameId: true },
          });
          const friends: Record<string, ReturnType<typeof presence>> = {};
          for (const link of links) {
            const peer = link.userAId === user.id ? link.userB : link.userA;
            let p = presence(peer.id);
            const solo = singlePlayerSessions.find((session) => session.userId === peer.id);
            if (solo && p.status !== 'inGame' && p.status !== 'inLobby')
              p = { status: 'inGame', gameId: solo.gameId, joinable: false };
            friends[peer.id] = peer.settings?.hideActivity
              ? { status: 'offline' }
              : peer.settings?.showGamePresence === false
                ? { status: p.status === 'offline' || p.status === 'away' ? p.status : 'online' }
                : p;
          }
          const member = await db.partyMember.findUnique({ where: { userId: user.id } });
          return void res.json({
            self: presence(user.id),
            friends,
            rooms: publicRooms(body.gameId),
            partyRoomId: member ? (partyRooms.get(member.partyId) ?? null) : null,
          });
        }
        if (body.action === 'authorizeInvite') {
          const room = body.roomId ? liveRooms.get(body.roomId) : undefined;
          if (!room || !room.players.has(user.id) || room.phase !== 'lobby')
            return void res.status(403).json({ error: 'requestRejected' });
          return void res.json({ ok: true, gameId: room.gameId });
        }
        if (body.action === 'cancel') {
          for (const room of liveRooms.values()) {
            room.pendingSeats.delete(user.id);
            if (!room.players.has(user.id)) room.admitted.delete(user.id);
          }
          return void res.json({ ok: true });
        }
        const result = await serialize(async () => {
          const entry = await db.userLibrary.findUnique({
            where: { userId_gameId: { userId: user.id, gameId: body.gameId ?? '' } },
            include: { game: true },
          });
          if (
            !entry ||
            !entry.game.published ||
            entry.game.status !== 'AVAILABLE' ||
            !entry.game.runtimeKey ||
            !gameServerAdapter(entry.game.runtimeKey)
          )
            throw new Error('Game unavailable');
          // One active room per account; no duplicate concurrent seats.
          const existing = [...liveRooms.values()].find((r) => r.players.has(user.id));
          if (existing) throw new Error('Already in a room');
          let room = body.roomId
            ? liveRooms.get(body.roomId)
            : body.code
              ? [...liveRooms.values()].find((r) => r.code === body.code)
              : undefined;
          let members = [user.id];
          let partyId: string | undefined;
          if (body.party) {
            const membership = await db.partyMember.findUnique({
              where: { userId: user.id },
              include: { party: { include: { members: true } } },
            });
            if (!membership) throw new Error('Party unavailable');
            partyId = membership.partyId;
            const assigned = partyRooms.get(partyId);
            if (assigned) room = liveRooms.get(assigned);
            if (!room && membership.party.leaderId !== user.id)
              throw new Error('Only party leader can search');
            members = membership.party.members.map((m) => m.userId);
            const eligible = await db.userLibrary.count({
              where: { userId: { in: members }, gameId: entry.gameId },
            });
            if (eligible !== members.length) throw new Error('All party members need this game');
          }
          if (members.length > gameServerAdapter(entry.game.runtimeKey).maxPlayers)
            throw new Error('Party exceeds mode capacity');
          if (body.action === 'quick' && !room) {
            for (const candidate of liveRooms.values()) {
              if (
                candidate.privateRoom ||
                candidate.phase !== 'lobby' ||
                candidate.gameId !== entry.gameId ||
                (gameServerAdapter(entry.game.runtimeKey).raceRoutes &&
                  candidate.route?.routeId !== selectRoute(body.routeId).routeId)
              )
                continue;
              const listing = await matchMaker.getRoomById(candidate.roomId);
              if (
                listing &&
                Math.max(listing.clients, candidate.occupancy()) +
                  members.filter(
                    (id) => !candidate.players.has(id) && !candidate.heldIds().includes(id),
                  ).length <=
                  candidate.maxClients &&
                !(await blocked(members, [...candidate.players.keys()]))
              ) {
                room = candidate;
                break;
              }
            }
          }
          if (!room && (body.action === 'create' || body.action === 'quick')) {
            const created = await matchMaker.createRoom(
              gameServerAdapter(entry.game.runtimeKey).roomName,
              {
                gameId: entry.gameId,
                routeId: body.routeId,
                carContacts:
                  body.action === 'create' && (body.private ?? true) && body.carContacts === true,
                runtimeKey: entry.game.runtimeKey,
                ownerId: user.id,
                private: body.action === 'quick' ? false : (body.private ?? true),
                maxPlayers: Math.min(
                  gameServerAdapter(entry.game.runtimeKey).maxPlayers,
                  Math.max(
                    members.length,
                    body.maxPlayers ?? gameServerAdapter(entry.game.runtimeKey).maxPlayers,
                  ),
                ),
                admitted: members,
                creationToken: signConnectionToken({
                  sub: user.id,
                  ver: user.tokenVersion,
                  kind: 'control',
                }),
              },
            );
            room = liveRooms.get(created.roomId)!;
          }
          if (!room || room.gameId !== entry.gameId || room.phase !== 'lobby')
            throw new Error('Room unavailable');
          if (await blocked(members, [...room.players.keys()]))
            throw new Error('Room access denied');
          if (room.privateRoom && !room.admitted.has(user.id)) {
            const invite = await db.gameInvite.findFirst({
              where: {
                recipientId: user.id,
                roomId: room.roomId,
                kind: 'GAME',
                expiresAt: { gt: new Date() },
              },
            });
            if (!invite || !room.players.has(invite.senderId))
              throw new Error('Private room invitation required');
            const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
            if (settings?.friendsOnlyInvites ?? true) {
              const [userAId, userBId] = [user.id, invite.senderId].sort();
              if (
                !(await db.friendship.findUnique({
                  where: { userAId_userBId: { userAId, userBId } },
                }))
              )
                throw new Error('Invitation privacy changed');
            }
            await db.gameInvite.update({
              where: { id: invite.id },
              data: { acceptedAt: new Date() },
            });
          }
          const listing = await matchMaker.getRoomById(room.roomId);
          if (
            !listing ||
            Math.max(listing.clients, room.occupancy()) +
              members.filter((id) => !room!.players.has(id) && !room!.heldIds().includes(id))
                .length >
              room.maxClients
          )
            throw new Error('Room full');
          members.forEach((id) => {
            room!.admitted.add(id);
            if (!room!.players.has(id) && !room!.pendingSeats.has(id))
              room!.pendingSeats.set(id, Date.now() + 60000);
          });
          room.pendingSeats.set(user.id, Date.now() + 20000);
          if (partyId) partyRooms.set(partyId, room.roomId);
          const token = room.seatToken(user.id, user.tokenVersion);
          const reservation = await matchMaker.reserveSeatFor(
            listing,
            { token },
            verifyConnectionToken(token, 'seat'),
          );
          return { reservation, endpoint: endpoint.origin, userId: user.id };
        });
        res.json(result);
      } catch {
        res.status(403).json({ error: 'networkRequestRejected' });
      }
    });
  },
});
for (const adapter of Object.values(registeredGameServers))
  gameServer.define(adapter.roomName, adapter.Room);
async function blocked(a: string[], b: string[]) {
  return !!(await db.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: { in: a }, blockedId: { in: b } },
        { blockerId: { in: b }, blockedId: { in: a } },
      ],
    },
  }));
}
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  cancellation.abort();
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  try {
    await gameServer.gracefullyShutdown(false);
    await db.$disconnect();
    await ownership.close();
    clearTimeout(deadline);
    process.exit(exitCode);
  } catch {
    process.exit(1);
  }
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
await gameServer.listen(
  Number(process.env.PORT ?? process.env.GAME_PORT ?? 2567),
  process.env.GAME_HOST ?? (process.env.NEXUS_DEPLOYMENT === 'railway' ? '::' : '0.0.0.0'),
);
try {
  await ownership.acquire(cancellation.signal);
  if (stopping) throw Error();
  await db.multiplayerMatch.updateMany({
    where: { status: { in: ['COUNTDOWN', 'RACING'] } },
    data: { status: 'ABORTED', endedAt: new Date() },
  });
  ready = true;
  console.log('NEXUS multiplayer ready; region=europe, racing=30/15Hz, forge=60/20Hz');
} catch {
  if (!stopping) {
    console.error('Game server could not acquire ownership');
    await shutdown(1);
  }
}
