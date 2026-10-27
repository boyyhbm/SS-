import { Room, type Client } from '@colyseus/core';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { multiplayerAdapters } from '../src/multiplayer/adapters';
import {
  cars,
  FIXED_DT,
  inputCommandSchema,
  RECONNECT_SECONDS,
  SIMULATION_HZ,
  SNAPSHOT_HZ,
  type InputCommand,
  type MatchPhase,
  type NetworkPlayer,
  type RoomSnapshot,
} from '../src/multiplayer/contracts';
import { liveRooms, metrics, online } from './state';
import { signConnectionToken, verifyConnectionToken, type ConnectionClaims } from './token';
import {
  selectRoute,
  getRoute,
  routeIdSchema,
  isCityRoute,
  type RouteId,
} from '../src/games/route-registry';
import { VEHICLE_VERSION, vehicleIdSchema, DEFAULT_VEHICLE } from '../src/games/vehicles/config';
import { isTrackId, getTrack } from '../src/games/tracks/registry';
import { configureVehicle } from '../src/games/vehicles/state';
const neutral = { throttle: 0, brake: 0, steer: 0, nitro: false };
type Player = NetworkPlayer & {
  latest: InputCommand | null;
  lastInputAt: number;
  received: number;
  strikes: number;
  sessionId: string;
  departed: boolean;
  connectedSeconds: number;
};
export class NexusRaceRoom extends Room {
  players = new Map<string, Player>();
  gameId = '';
  runtimeKey = '';
  code = '';
  leaderId = '';
  phase: MatchPhase = 'lobby';
  privateRoom = true;
  laps = 1;
  route = selectRoute();
  tick = 0;
  startsAt: number | null = null;
  matchId: string | null = null;
  saved = false;
  elapsed = 0;
  saving = false;
  contactEvents = 0;
  admitted = new Set<string>();
  pendingSeats = new Map<string, number>();
  heldIds() {
    for (const [id, expires] of this.pendingSeats)
      if (expires < Date.now()) this.pendingSeats.delete(id);
    return [...this.pendingSeats.keys()].filter((id) => !this.players.has(id));
  }
  occupancy() {
    return this.players.size + this.heldIds().length;
  }
  onCreate(options: {
    gameId: string;
    runtimeKey: string;
    ownerId: string;
    private: boolean;
    maxPlayers: number;
    admitted?: string[];
    creationToken: string;
    routeId?: RouteId;
    carContacts?: boolean;
  }) {
    const creator = verifyConnectionToken(options.creationToken, 'control');
    if (creator.sub !== options.ownerId) throw new Error('Unauthorized room creation');
    this.gameId = options.gameId;
    this.runtimeKey = options.runtimeKey;
    if (!multiplayerAdapters[this.runtimeKey]) throw new Error('Unregistered multiplayer adapter');
    this.route = selectRoute(
      routeIdSchema.parse(options.routeId ?? 'legacy-circuit'),
      1,
      options.private &&
        process.env.NEXUS_PRIVATE_CAR_CONTACTS === '1' &&
        options.carContacts === true,
    );
    this.laps = this.route.laps;
    this.maxClients = Math.min(options.maxPlayers, getRoute(this.route.routeId).maxPlayers);
    this.maxMessagesPerSecond = 80;
    this.privateRoom = options.private;
    this.leaderId = options.ownerId;
    do {
      this.code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    } while ([...liveRooms.values()].some((r) => r.code === this.code));
    this.admitted = new Set([options.ownerId, ...(options.admitted ?? [])]);
    for (const id of this.admitted) this.pendingSeats.set(id, Date.now() + 60000);
    this.setSeatReservationTime(20);
    liveRooms.set(this.roomId, this);
    this.onMessage('input', (client, raw: unknown) => {
      metrics.messages++;
      const p = this.player(client);
      const parsed = inputCommandSchema.safeParse(raw);
      if (parsed.success && p && parsed.data.seq <= p.received) return;
      if (!parsed.success || !p || parsed.data.seq > p.received + 180) {
        metrics.rejectedMessages++;
        if (p && p.strikes === 0)
          console.warn(
            'NEXUS input validation',
            JSON.stringify({
              reason: parsed.success
                ? 'sequence-gap'
                : parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
              sequenceGap: parsed.success ? parsed.data.seq - p.received : null,
            }),
          );
        if (p && ++p.strikes > 8) void client.leave(4403, 'Invalid input');
        return;
      }
      p.latest = parsed.data;
      p.received = parsed.data.seq;
      p.lastInputAt = Date.now();
      online.set(p.id, { seen: Date.now(), active: Date.now() });
    });
    this.onMessage('ready', (client, raw: unknown) => {
      metrics.messages++;
      const p = this.player(client);
      if (p && this.phase === 'lobby' && typeof raw === 'boolean') {
        p.ready = raw;
        this.sendSnapshot();
      }
    });
    this.onMessage('car', (client, raw: unknown) => {
      metrics.messages++;
      const p = this.player(client);
      const car = z.enum(cars).safeParse(raw);
      if (p && this.phase === 'lobby' && car.success) {
        if (p.car !== car.data) {
          p.car = car.data;
          p.ready = false;
        }
        this.sendSnapshot();
      }
    });
    this.onMessage('vehicle', (client, raw: unknown) => {
      metrics.messages++;
      const p = this.player(client);
      const parsed = z
        .object({ vehicleId: vehicleIdSchema, vehicleVersion: z.literal(VEHICLE_VERSION) })
        .strict()
        .safeParse(raw);
      if (!p || this.phase !== 'lobby' || !parsed.success) {
        metrics.rejectedMessages++;
        return;
      }
      if (p.vehicleId !== parsed.data.vehicleId || p.vehicleVersion !== VEHICLE_VERSION) {
        p.vehicleId = parsed.data.vehicleId;
        p.vehicleVersion = VEHICLE_VERSION;
        configureVehicle(p.state, p.vehicleId);
        p.ready = false;
      }
      this.sendSnapshot();
    });
    this.onMessage('settings', (client, raw: unknown) => {
      metrics.messages++;
      const settings = z
        .object({
          laps: z.number().int().min(1).max(3),
          routeId: routeIdSchema.optional(),
          carContacts: z.boolean().optional(),
        })
        .strict()
        .safeParse(raw);
      if (client.auth.sub === this.leaderId && this.phase === 'lobby' && settings.success) {
        this.route = selectRoute(
          settings.data.routeId ?? this.route.routeId,
          settings.data.laps,
          this.privateRoom &&
            process.env.NEXUS_PRIVATE_CAR_CONTACTS === '1' &&
            (settings.data.carContacts ?? this.route.carContacts ?? false),
        );
        this.laps = this.route.laps;
        [...this.players.values()].forEach((p, i) => {
          p.ready = false;
          p.state = this.adapter.initialState(i, this.route, p.vehicleId);
        });
        this.sendSnapshot();
      }
    });
    this.onMessage('start', (client) => {
      metrics.messages++;
      if (client.auth.sub !== this.leaderId) return;
      void this.startMatch().catch(() => client.send('notice', 'serverError'));
    });
    this.onMessage('rematch', (client) => {
      metrics.messages++;
      if (client.auth.sub === this.leaderId && this.phase === 'results' && this.saved) {
        this.phase = 'lobby';
        this.startsAt = null;
        this.matchId = null;
        this.saved = false;
        for (const [id, p] of this.players) if (p.departed) this.players.delete(id);
        [...this.players.values()].forEach((p, i) => {
          p.ready = false;
          p.finish = null;
          p.place = null;
          p.state = this.adapter.initialState(i, this.route, p.vehicleId);
          p.latest = null;
        });
        void this.unlock();
        this.sendSnapshot();
      }
    });
    this.onMessage('ping', (client, raw: unknown) => {
      metrics.messages++;
      if (typeof raw === 'number' && Number.isFinite(raw))
        client.send('pong', { echo: raw, serverTime: Date.now() });
    });
    this.setSimulationInterval(() => this.simulate(), 1000 / SIMULATION_HZ);
    this.clock.setInterval(() => this.sendSnapshot(), 1000 / SNAPSHOT_HZ);
    this.clock.setInterval(() => {
      if (this.phase === 'results' && !this.saved) void this.persistResults();
    }, 5000);
    this.clock.setTimeout(() => {
      if (!this.players.size) void this.disconnect();
    }, 25000);
  }
  get adapter() {
    return multiplayerAdapters[this.runtimeKey];
  }
  player(client: Client) {
    return this.players.get((client.auth as ConnectionClaims).sub);
  }
  static async onAuth(_token: string, options: { token?: string }) {
    const claims = verifyConnectionToken(options.token, 'seat');
    const room = claims.roomId ? liveRooms.get(claims.roomId) : undefined;
    if (
      !room ||
      !room.admitted.has(claims.sub) ||
      room.phase !== 'lobby' ||
      room.players.has(claims.sub)
    )
      throw new Error('Room access denied');
    const user = await db.user.findUnique({
      where: { id: claims.sub },
      select: {
        tokenVersion: true,
        library: { where: { gameId: room.gameId }, select: { id: true } },
      },
    });
    if (!user || user.tokenVersion !== claims.ver || !user.library.length)
      throw new Error('Room access denied');
    return claims;
  }
  async onJoin(client: Client) {
    const claims = client.auth as ConnectionClaims;
    const id = claims.sub;
    if (claims.roomId !== this.roomId || !this.admitted.has(id))
      throw new Error('Room access denied');
    if (this.phase !== 'lobby' || this.players.has(id) || this.players.size >= this.maxClients)
      throw new Error('Room full');
    const user = await db.user.findUniqueOrThrow({
      where: { id },
      select: {
        username: true,
        avatar: true,
        tokenVersion: true,
        library: { where: { gameId: this.gameId }, select: { id: true } },
      },
    });
    if (user.tokenVersion !== claims.ver || !user.library.length)
      throw new Error('Room access denied');
    // onJoin can await database access; check capacity again after it.
    if (this.phase !== 'lobby' || this.players.has(id) || this.players.size >= this.maxClients)
      throw new Error('Room full');
    this.players.set(id, {
      id,
      username: user.username,
      avatar: user.avatar,
      car: 'silver',
      vehicleId: DEFAULT_VEHICLE,
      vehicleVersion: VEHICLE_VERSION,
      ready: false,
      connected: true,
      state: this.adapter.initialState(this.players.size, this.route, DEFAULT_VEHICLE),
      ack: -1,
      finish: null,
      place: null,
      latest: null,
      lastInputAt: 0,
      received: -1,
      strikes: 0,
      sessionId: client.sessionId,
      departed: false,
      connectedSeconds: 0,
    });
    this.pendingSeats.delete(id);
    metrics.connections++;
    this.sendSnapshot();
    this.broadcast('event', { type: 'playerJoined', username: user.username });
  }
  async onDrop(client: Client) {
    const p = this.player(client);
    if (!p) return;
    p.connected = false;
    p.latest = null;
    metrics.disconnects++;
    this.sendSnapshot();
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
    } catch {
      /* onLeave removes expired seats */
    }
  }
  async onReconnect(client: Client) {
    const claims = client.auth as ConnectionClaims;
    const user = await db.user.findUnique({
      where: { id: claims.sub },
      select: { tokenVersion: true },
    });
    if (!user || user.tokenVersion !== claims.ver) throw new Error('Session revoked');
    const p = this.player(client);
    if (!p) return;
    p.connected = true;
    p.latest = null;
    p.lastInputAt = 0;
    metrics.reconnects++;
    this.sendSnapshot();
    client.send('event', { type: 'reconnected' });
  }
  async onLeave(client: Client) {
    const p = this.player(client);
    if (!p) return;
    if (this.phase === 'countdown' || this.phase === 'racing') {
      p.connected = false;
      p.latest = null;
      p.departed = true;
      if (this.matchId)
        await db.matchParticipant.updateMany({
          where: { matchId: this.matchId, userId: p.id },
          data: { disconnected: true },
        });
    } else this.players.delete(p.id);
    const connected = [...this.players.values()].filter((p) => p.connected);
    if (this.leaderId === p.id && connected.length) this.leaderId = connected[0].id;
    this.sendSnapshot();
  }
  snapshot(): RoomSnapshot {
    return {
      roomId: this.roomId,
      code: this.code,
      gameId: this.gameId,
      leaderId: this.leaderId,
      phase: this.phase,
      region: 'europe',
      mode: getRoute(this.route.routeId).kind,
      route: this.route,
      private: this.privateRoom,
      maxPlayers: this.maxClients,
      laps: this.laps,
      serverTime: Date.now(),
      tick: this.tick,
      startsAt: this.startsAt,
      matchId: this.matchId,
      saved: this.saved,
      contactEvents: this.contactEvents,
      privateContactsAvailable:
        this.privateRoom &&
        process.env.NEXUS_PRIVATE_CAR_CONTACTS === '1' &&
        isCityRoute(this.route.routeId),
      players: [...this.players.values()].map(
        ({
          id,
          username,
          avatar,
          car,
          vehicleId,
          vehicleVersion,
          ready,
          connected,
          state,
          ack,
          finish,
          place,
        }) => ({
          id,
          username,
          avatar,
          car,
          vehicleId,
          vehicleVersion,
          ready,
          connected,
          state: { ...state },
          ack,
          finish,
          place,
        }),
      ),
    };
  }
  sendSnapshot() {
    this.broadcast('snapshot', this.snapshot());
  }
  async startMatch() {
    if (
      this.phase !== 'lobby' ||
      this.players.size < 2 ||
      [...this.players.values()].some((p) => !p.ready || !p.connected)
    )
      return;
    // Change phase before the first await: concurrent Start commands cannot create two matches.
    this.phase = 'countdown';
    await this.lock();
    try {
      const match = await db.$transaction(async (tx) => {
        const match = await tx.multiplayerMatch.create({
          data: {
            gameId: this.gameId,
            roomId: this.roomId,
            mode: getRoute(this.route.routeId).kind,
            routeId: this.route.routeId,
            routeVersion: this.route.routeVersion,
            laps: this.laps,
            carContacts: this.route.carContacts ?? false,
            participants: {
              create: [...this.players.values()].map((p) => ({
                userId: p.id,
                car: p.car,
                vehicleId: p.vehicleId,
                vehicleVersion: p.vehicleVersion,
              })),
            },
          },
        });
        await tx.userLibrary.updateMany({
          where: { gameId: this.gameId, userId: { in: [...this.players.keys()] } },
          data: { lastPlayedAt: new Date() },
        });
        return match;
      });
      this.matchId = match.id;
      this.startsAt = Date.now() + 3000;
      this.tick = 0;
      this.elapsed = 0;
      this.contactEvents = 0;
      [...this.players.values()].forEach((p, i) => {
        p.state = this.adapter.initialState(i, this.route, p.vehicleId);
        p.finish = null;
        p.place = null;
        p.latest = null;
        p.ack = p.received;
        p.connectedSeconds = 0;
      });
      this.sendSnapshot();
    } catch {
      this.phase = 'lobby';
      await this.unlock();
      throw new Error('Match creation failed');
    }
  }
  simulate() {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return;
    if (this.phase === 'countdown') {
      if (!this.startsAt || Date.now() < this.startsAt) return;
      this.phase = 'racing';
      if (this.matchId)
        void db.multiplayerMatch
          .update({
            where: { id: this.matchId },
            data: { status: 'RACING', startedAt: new Date(this.startsAt) },
          })
          .catch(() => {});
    }
    const before = performance.now();
    this.tick++;
    this.elapsed += FIXED_DT;
    const moving: {
      p: Player;
      state: Player['state'];
      input: InputCommand | typeof neutral;
      previous: { x: number; z: number };
    }[] = [];
    for (const p of this.players.values()) {
      if (p.connected) p.connectedSeconds += FIXED_DT;
      if (p.finish !== null) continue;
      const input = p.connected && Date.now() - p.lastInputAt < 250 ? p.latest : null;
      if (input) p.ack = input.seq;
      moving.push({
        p,
        state: p.state,
        input: input ?? neutral,
        previous: { x: p.state.x, z: p.state.z },
      });
    }
    if (this.adapter.simulateGroup) {
      const contacts = this.adapter.simulateGroup(moving, FIXED_DT, this.route) ?? 0;
      metrics.vehicleContacts += contacts;
      this.contactEvents += contacts;
    } else
      for (const item of moving)
        this.adapter.simulate(item.state, item.input, FIXED_DT, this.route);
    for (const { p, previous } of moving) {
      // Defense in depth: simulation must never exceed its own speed / track invariants.
      if (
        ![p.state.x, p.state.z, p.state.heading, p.state.vx, p.state.vz, p.state.speed].every(
          Number.isFinite,
        ) ||
        Math.hypot(p.state.x - previous.x, p.state.z - previous.z) > 5
      ) {
        p.state = this.adapter.initialState(0, this.route, p.vehicleId);
        metrics.rejectedMessages++;
      }
      if (p.state.lap > this.laps) {
        p.finish = this.elapsed;
        p.place = [...this.players.values()].filter((other) => other.finish !== null).length;
      }
    }
    const duration = performance.now() - before;
    metrics.ticks++;
    metrics.tickTotalMs += duration;
    metrics.tickMaxMs = Math.max(metrics.tickMaxMs, duration);
    if (
      [...this.players.values()].every((p) => p.finish !== null || p.departed) ||
      this.elapsed >=
        (isTrackId(this.route.routeId)
          ? getTrack(this.route.routeId).durationLimitSeconds
          : this.route.routeId === 'legacy-circuit'
            ? 120
            : 240) *
          this.laps
    ) {
      this.phase = 'results';
      this.sendSnapshot();
      void this.persistResults();
    }
  }
  async persistResults() {
    if (!this.matchId || this.saving || this.saved) return;
    this.saving = true;
    try {
      const matchId = this.matchId;
      await db.$transaction(async (tx) => {
        // Idempotent settlement; also protects retries after an uncertain DB response.
        const changed = await tx.multiplayerMatch.updateMany({
          where: { id: matchId, status: { in: ['COUNTDOWN', 'RACING'] } },
          data: { status: 'FINISHED', endedAt: new Date() },
        });
        if (!changed.count) return;
        for (const p of this.players.values()) {
          const participant = await tx.matchParticipant.findUniqueOrThrow({
            where: { matchId_userId: { matchId, userId: p.id } },
          });
          await tx.matchResult.create({
            data: {
              participantId: participant.id,
              place: p.place,
              timeSeconds: p.finish,
              didFinish: p.finish !== null,
              serverVerified: true,
            },
          });
          await tx.playerRating.upsert({
            where: {
              userId_gameId_mode: {
                userId: p.id,
                gameId: this.gameId,
                mode: getRoute(this.route.routeId).kind,
              },
            },
            create: {
              userId: p.id,
              gameId: this.gameId,
              mode: getRoute(this.route.routeId).kind,
              races: 1,
              wins: p.place === 1 ? 1 : 0,
            },
            update: { races: { increment: 1 }, wins: { increment: p.place === 1 ? 1 : 0 } },
          });
          await tx.gameSession.create({
            data: {
              userId: p.id,
              gameId: this.gameId,
              startedAt: new Date(this.startsAt!),
              endedAt: new Date(),
              durationSeconds: Math.floor(p.connectedSeconds),
              isPaused: true,
            },
          });
        }
      });
      this.saved = true;
      this.sendSnapshot();
    } catch {
      /* Keep results in memory and retry. No fabricated success. */
    } finally {
      this.saving = false;
    }
  }
  async onDispose() {
    liveRooms.delete(this.roomId);
    if (this.phase === 'results' && !this.saved) await this.persistResults();
    if (this.matchId && !this.saved)
      await db.multiplayerMatch
        .updateMany({
          where: { id: this.matchId, status: { in: ['COUNTDOWN', 'RACING'] } },
          data: { status: 'ABORTED', endedAt: new Date() },
        })
        .catch(() => {});
  }
  seatToken(userId: string, ver: number) {
    return signConnectionToken({ sub: userId, ver, kind: 'seat', roomId: this.roomId });
  }
}
