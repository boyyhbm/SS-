import type { Presence, RoomSummary, MatchPhase } from '../src/multiplayer/contracts';
export interface PlatformRoom {
  roomId: string;
  gameId: string;
  code: string;
  leaderId: string;
  phase: MatchPhase;
  privateRoom: boolean;
  maxClients: number;
  players: Map<string, { id: string; connected: boolean }>;
  admitted: Set<string>;
  pendingSeats: Map<string, number>;
  heldIds(): string[];
  occupancy(): number;
  seatToken(userId: string, version: number): string;
}
export const liveRooms = new Map<string, PlatformRoom>();
export const online = new Map<string, { seen: number; active: number }>();
export const partyRooms = new Map<string, string>();
export const metrics = {
  ticks: 0,
  tickTotalMs: 0,
  tickMaxMs: 0,
  messages: 0,
  rejectedMessages: 0,
  disconnects: 0,
  reconnects: 0,
  connections: 0,
  startedAt: Date.now(),
};
export function presence(userId: string): Presence {
  for (const room of liveRooms.values()) {
    const player = room.players.get(userId);
    if (player?.connected)
      return {
        status: room.phase === 'racing' || room.phase === 'countdown' ? 'inGame' : 'inLobby',
        roomId: room.roomId,
        gameId: room.gameId,
        joinable:
          !room.privateRoom && room.phase === 'lobby' && room.players.size < room.maxClients,
      };
  }
  const user = online.get(userId);
  if (!user || Date.now() - user.seen > 40000) return { status: 'offline' };
  return { status: Date.now() - user.active > 120000 ? 'away' : 'online' };
}
export function publicRooms(gameId?: string): RoomSummary[] {
  return [...liveRooms.values()]
    .filter((r) => !r.privateRoom && r.phase === 'lobby' && (!gameId || r.gameId === gameId))
    .map((r) => ({
      roomId: r.roomId,
      code: r.code,
      players: r.players.size,
      maxPlayers: r.maxClients,
      phase: r.phase,
      region: 'europe',
      gameId: r.gameId,
    }));
}
