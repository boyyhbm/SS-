import { Room, type Client } from '@colyseus/core';
import { randomBytes } from 'node:crypto';
import { db } from '../src/lib/db';
import { liveRooms, metrics, online } from './state';
import { signConnectionToken, verifyConnectionToken, type ConnectionClaims } from './token';
import { ForgeSimulation } from '../src/games/fold/simulation';
import {
  foldCommandSchema,
  neutralCommand,
  type ForgeCommand,
  type ForgeSnapshot,
} from '../src/games/fold/contracts';
import { FOLD_DT, FOLD_HZ, FOLD_SNAPSHOT_HZ, FORGE_VERSION } from '../src/games/fold/config';
import type { MatchPhase } from '../src/multiplayer/contracts';
import { FixedStepClock } from '../src/games/fixed-clock';
type Member = {
  id: string;
  username: string;
  slot: number;
  connected: boolean;
  ready: boolean;
  ack: number;
  received: number;
  input: ForgeCommand;
  lastInput: number;
  strikes: number;
  departed: boolean;
};
export class NexusFoldRoom extends Room {
  gameId = '';
  code = '';
  leaderId = '';
  phase: MatchPhase = 'lobby';
  privateRoom = true;
  admitted = new Set<string>();
  pendingSeats = new Map<string, number>();
  players = new Map<string, Member>();
  simulation: ForgeSimulation | null = null;
  matchId: string | null = null;
  saved = false;
  private saving = false;
  heldIds() {
    for (const [id, t] of this.pendingSeats) if (t < Date.now()) this.pendingSeats.delete(id);
    return [...this.pendingSeats.keys()].filter((id) => !this.players.has(id));
  }
  occupancy() {
    return this.players.size + this.heldIds().length;
  }
  seatToken(sub: string, ver: number) {
    return signConnectionToken({ sub, ver, kind: 'seat', roomId: this.roomId });
  }
  onCreate(options: {
    gameId: string;
    runtimeKey: string;
    ownerId: string;
    private: boolean;
    admitted?: string[];
    creationToken: string;
  }) {
    const claims = verifyConnectionToken(options.creationToken, 'control');
    if (claims.sub !== options.ownerId || options.runtimeKey !== 'fold-zero')
      throw Error('Unauthorized');
    this.gameId = options.gameId;
    this.leaderId = options.ownerId;
    this.privateRoom = options.private;
    this.maxClients = 2;
    this.maxMessagesPerSecond = 90;
    this.setSeatReservationTime(20);
    do {
      this.code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    } while ([...liveRooms.values()].some((r) => r.code === this.code));
    this.admitted = new Set([options.ownerId, ...(options.admitted ?? [])]);
    for (const id of this.admitted) this.pendingSeats.set(id, Date.now() + 60000);
    liveRooms.set(this.roomId, this);
    this.onMessage('input', (c, raw: unknown) => {
      metrics.messages++;
      const p = this.member(c),
        parsed = foldCommandSchema.safeParse(raw);
      if (parsed.success && p && parsed.data.seq <= p.received) return;
      if (!p || !parsed.success || parsed.data.seq > p.received + 240) {
        metrics.rejectedMessages++;
        if (p && ++p.strikes > 8) void c.leave(4403, 'Invalid input');
        return;
      }
      p.received = parsed.data.seq;
      p.input = parsed.data;
      p.lastInput = Date.now();
      online.set(p.id, { seen: Date.now(), active: Date.now() });
    });
    this.onMessage('ready', (c, raw: unknown) => {
      const p = this.member(c);
      if (
        p &&
        this.phase === 'lobby' &&
        raw &&
        typeof raw === 'object' &&
        'protocol' in raw &&
        raw.protocol === FORGE_VERSION &&
        'ready' in raw &&
        typeof raw.ready === 'boolean'
      ) {
        p.ready = raw.ready;
        this.sendSnapshot();
      }
    });
    this.onMessage('start', (c) => {
      console.info(
        'FORGE start request',
        JSON.stringify({
          phase: this.phase,
          leader: c.auth.sub === this.leaderId,
          players: [...this.players.values()].map((p) => ({
            ready: p.ready,
            connected: p.connected,
            departed: p.departed,
          })),
        }),
      );
      if (c.auth.sub === this.leaderId)
        void this.startMatch().catch(() => c.send('notice', 'Match creation failed'));
    });
    this.onMessage('rematch', (c) => {
      if (c.auth.sub === this.leaderId && this.phase === 'results' && this.saved) {
        this.simulation?.dispose();
        this.simulation = null;
        this.phase = 'lobby';
        this.matchId = null;
        this.saved = false;
        for (const [id, p] of this.players) if (p.departed) this.players.delete(id);
        for (const p of this.players.values()) {
          p.ready = false;
          p.input = neutralCommand();
        }
        void this.unlock();
        this.sendSnapshot();
      }
    });
    this.onMessage('ping', (c, value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value))
        c.send('pong', { echo: value, serverTime: Date.now() });
    });
    // Fixed simulation steps, bounded catch-up. A delayed event-loop callback must
    // not silently turn a 60 Hz simulation into slow motion or a giant variable step.
    let last = performance.now();
    const clock = new FixedStepClock(FOLD_DT, 0.1);
    this.setSimulationInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, (now - last) / 1000);
      last = now;
      clock.advance(elapsed, () => this.simulate());
    }, 1000 / FOLD_HZ);
    this.clock.setInterval(() => this.sendSnapshot(), 1000 / FOLD_SNAPSHOT_HZ);
    this.clock.setInterval(() => {
      if (this.phase === 'results' && !this.saved) void this.persistResults();
    }, 3000);
    this.clock.setTimeout(() => {
      if (!this.players.size) void this.disconnect();
    }, 25000);
  }
  private member(c: Client) {
    return this.players.get((c.auth as ConnectionClaims).sub);
  }
  static async onAuth(_token: string, options: { token?: string }) {
    const c = verifyConnectionToken(options.token, 'seat'),
      r = c.roomId ? liveRooms.get(c.roomId) : undefined;
    if (!r || !r.admitted.has(c.sub) || r.phase !== 'lobby' || r.players.has(c.sub))
      throw Error('Room access denied');
    const u = await db.user.findUnique({
      where: { id: c.sub },
      select: {
        tokenVersion: true,
        library: { where: { gameId: r.gameId }, select: { id: true } },
      },
    });
    if (!u || u.tokenVersion !== c.ver || !u.library.length) throw Error('Room access denied');
    return c;
  }
  async onJoin(c: Client) {
    const claims = c.auth as ConnectionClaims;
    if (claims.roomId !== this.roomId || !this.admitted.has(claims.sub))
      throw Error('Room access denied');
    const u = await db.user.findUniqueOrThrow({
      where: { id: claims.sub },
      select: {
        username: true,
        tokenVersion: true,
        library: { where: { gameId: this.gameId }, select: { id: true } },
      },
    });
    if (
      u.tokenVersion !== claims.ver ||
      !u.library.length ||
      this.phase !== 'lobby' ||
      this.players.has(claims.sub) ||
      this.players.size >= 2
    )
      throw Error('Room access denied');
    const slot =
      this.players.has([...this.players.keys()][0]) && [...this.players.values()][0]?.slot === 0
        ? 1
        : 0;
    this.players.set(claims.sub, {
      id: claims.sub,
      username: u.username,
      slot,
      connected: true,
      ready: false,
      ack: -1,
      received: -1,
      input: neutralCommand(),
      lastInput: 0,
      strikes: 0,
      departed: false,
    });
    this.pendingSeats.delete(claims.sub);
    metrics.connections++;
    this.sendSnapshot();
  }
  async onDrop(c: Client) {
    const p = this.member(c);
    if (!p) return;
    p.connected = false;
    p.input = neutralCommand();
    metrics.disconnects++;
    this.sendSnapshot();
    try {
      await this.allowReconnection(c, 30);
    } catch {
      /* Expiry is settled by onLeave. */
    }
  }
  async onReconnect(c: Client) {
    const p = this.member(c),
      u = await db.user.findUnique({ where: { id: c.auth.sub }, select: { tokenVersion: true } });
    if (!p || !u || u.tokenVersion !== c.auth.ver) throw Error('Session revoked');
    p.connected = true;
    p.lastInput = 0;
    metrics.reconnects++;
    this.sendSnapshot();
  }
  onLeave(c: Client) {
    const p = this.member(c);
    if (!p) return;
    p.connected = false;
    p.departed = true;
    if (this.phase === 'racing' || this.phase === 'countdown') {
      this.simulation?.forfeit(p.id);
      this.phase = 'results';
      void this.persistResults();
    } else this.players.delete(p.id);
    if (p.id === this.leaderId)
      this.leaderId = [...this.players.values()].find((p) => p.connected)?.id ?? this.leaderId;
    this.sendSnapshot();
  }
  async startMatch() {
    if (
      this.phase !== 'lobby' ||
      this.players.size !== 2 ||
      [...this.players.values()].some((p) => !p.ready || !p.connected)
    )
      return;
    this.phase = 'countdown';
    await this.lock();
    try {
      const people = [...this.players.values()].sort((a, b) => a.slot - b.slot);
      this.simulation = await ForgeSimulation.create(people.map((p) => p.id));
      if (people.some((p) => !p.connected || p.departed)) throw Error('Participant left');
      const match = await db.$transaction(async (tx) => {
        const m = await tx.multiplayerMatch.create({
          data: {
            gameId: this.gameId,
            roomId: this.roomId,
            mode: 'duel',
            routeId: 'the-foundry',
            routeVersion: FORGE_VERSION,
            laps: 1,
            participants: {
              create: people.map((p) => ({ userId: p.id, car: p.slot ? 'coral' : 'cyan' })),
            },
          },
        });
        await tx.userLibrary.updateMany({
          where: { gameId: this.gameId, userId: { in: people.map((p) => p.id) } },
          data: { lastPlayedAt: new Date() },
        });
        return m;
      });
      this.matchId = match.id;
      for (const p of people) p.ack = p.received;
      const departed = people.find((p) => p.departed);
      if (departed) {
        this.simulation.forfeit(departed.id);
        this.phase = 'results';
        void this.persistResults();
      }
      this.sendSnapshot();
    } catch (error) {
      console.warn(
        'FORGE start failed',
        JSON.stringify({
          kind: error instanceof Error ? error.name : 'Unknown',
          code:
            error &&
            typeof error === 'object' &&
            'code' in error &&
            /^P[0-9]{4}$/.test(String(error.code))
              ? String(error.code)
              : null,
          participantLeft: error instanceof Error && error.message === 'Participant left',
        }),
      );
      this.simulation?.dispose();
      this.simulation = null;
      this.phase = 'lobby';
      for (const [id, p] of this.players) if (p.departed) this.players.delete(id);
      await this.unlock();
      throw Error('Match creation failed');
    }
  }
  private simulate() {
    if (
      !this.simulation ||
      !this.matchId ||
      (this.phase !== 'countdown' && this.phase !== 'racing')
    )
      return;
    const before = performance.now(),
      inputs = new Map<string, ForgeCommand>();
    for (const p of this.players.values()) {
      const active = p.connected && Date.now() - p.lastInput < 220;
      inputs.set(
        p.id,
        active
          ? p.input
          : {
              ...neutralCommand(),
              yaw: this.simulation.state.players.find((q) => q.id === p.id)?.yaw ?? 0,
            },
      );
      if (active) p.ack = p.received;
    }
    this.simulation.step(inputs);
    const s = this.simulation.state;
    if (this.phase === 'countdown' && s.phase === 'active') {
      this.phase = 'racing';
      if (this.matchId)
        void db.multiplayerMatch
          .update({ where: { id: this.matchId }, data: { status: 'RACING' } })
          .catch(() => {});
    }
    metrics.ticks++;
    const dt = performance.now() - before;
    metrics.tickTotalMs += dt;
    metrics.tickMaxMs = Math.max(metrics.tickMaxMs, dt);
    if (s.phase === 'finished') {
      this.phase = 'results';
      this.sendSnapshot();
      void this.persistResults();
    }
  }
  snapshot(): ForgeSnapshot {
    return {
      protocol: FORGE_VERSION,
      roomId: this.roomId,
      code: this.code,
      gameId: this.gameId,
      leaderId: this.leaderId,
      phase: this.phase,
      private: this.privateRoom,
      serverTime: Date.now(),
      matchId: this.matchId,
      saved: this.saved,
      players: [...this.players.values()].map(({ id, username, slot, connected, ready, ack }) => ({
        id,
        username,
        slot,
        connected,
        ready,
        ack,
      })),
      game: this.simulation?.snapshot() ?? null,
    };
  }
  private sendSnapshot() {
    this.broadcast('snapshot', this.snapshot());
  }
  private async persistResults() {
    if (!this.matchId || this.saved || this.saving || !this.simulation) return;
    this.saving = true;
    const id = this.matchId,
      state = this.simulation.snapshot();
    try {
      await db.$transaction(async (tx) => {
        const changed = await tx.multiplayerMatch.updateMany({
          where: { id, status: { in: ['COUNTDOWN', 'RACING'] } },
          data: { status: 'FINISHED', endedAt: new Date() },
        });
        if (!changed.count) return;
        for (const p of this.players.values()) {
          const participant = await tx.matchParticipant.findUniqueOrThrow({
            where: { matchId_userId: { matchId: id, userId: p.id } },
          });
          const won = state.winner === p.id,
            place = state.winner ? (won ? 1 : 2) : null;
          await tx.matchResult.create({
            data: {
              participantId: participant.id,
              place,
              timeSeconds: state.tick * FOLD_DT,
              didFinish: !p.departed,
              serverVerified: true,
              details: {
                score: state.score,
                slot: p.slot,
                rounds: state.round,
                winner: state.winner,
                reason: state.reason,
                protocol: FORGE_VERSION,
              },
            },
          });
          await tx.playerRating.upsert({
            where: { userId_gameId_mode: { userId: p.id, gameId: this.gameId, mode: 'duel' } },
            create: {
              userId: p.id,
              gameId: this.gameId,
              mode: 'duel',
              races: 1,
              wins: won ? 1 : 0,
            },
            update: { races: { increment: 1 }, wins: { increment: won ? 1 : 0 } },
          });
          await tx.gameSession.create({
            data: {
              userId: p.id,
              gameId: this.gameId,
              startedAt: new Date(Date.now() - state.tick * FOLD_DT * 1000),
              endedAt: new Date(),
              durationSeconds: Math.floor(state.tick * FOLD_DT),
              isPaused: true,
            },
          });
        }
      });
      this.saved = true;
      this.sendSnapshot();
    } catch {
      /* Keep the exact authoritative result and retry, never mark an uncommitted result saved. */
    } finally {
      this.saving = false;
    }
  }
  async onDispose() {
    liveRooms.delete(this.roomId);
    if (this.phase === 'results' && !this.saved) await this.persistResults();
    this.simulation?.dispose();
    if (this.matchId && !this.saved)
      await db.multiplayerMatch
        .updateMany({
          where: { id: this.matchId, status: { in: ['COUNTDOWN', 'RACING'] } },
          data: { status: 'ABORTED', endedAt: new Date() },
        })
        .catch(() => {});
  }
}
