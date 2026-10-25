import { z } from 'zod';
import type { RaceInput, RaceState } from '../games/racing-physics';
export const SIMULATION_HZ = 30;
export const SNAPSHOT_HZ = 15;
export const FIXED_DT = 1 / SIMULATION_HZ;
export const RECONNECT_SECONDS = 30;
export const cars = ['silver', 'violet', 'cyan'] as const;
export const inputCommandSchema = z
  .object({
    seq: z.number().int().min(0).max(2147483647),
    throttle: z.number().finite().min(0).max(1),
    brake: z.number().finite().min(0).max(1),
    steer: z.number().finite().min(-1).max(1),
    nitro: z.boolean(),
    handbrake: z.boolean().optional(),
  })
  .strict();
export type InputCommand = z.infer<typeof inputCommandSchema>;
export type MatchPhase = 'lobby' | 'countdown' | 'racing' | 'results';
export interface NetworkPlayer<State = RaceState> {
  id: string;
  username: string;
  avatar: string;
  car: (typeof cars)[number];
  ready: boolean;
  connected: boolean;
  state: State;
  ack: number;
  finish: number | null;
  place: number | null;
}
export interface RoomSnapshot<State = RaceState> {
  roomId: string;
  code: string;
  gameId: string;
  leaderId: string;
  phase: MatchPhase;
  region: 'europe';
  mode: 'circuit';
  private: boolean;
  maxPlayers: number;
  laps: number;
  serverTime: number;
  tick: number;
  startsAt: number | null;
  matchId: string | null;
  saved: boolean;
  players: NetworkPlayer<State>[];
}
export interface RoomSummary {
  roomId: string;
  code: string;
  players: number;
  maxPlayers: number;
  phase: MatchPhase;
  region: string;
  gameId: string;
}
export interface MultiplayerCapabilities {
  singlePlayer: boolean;
  onlineMultiplayer: boolean;
  localMultiplayer: boolean;
  coop: boolean;
  competitive: boolean;
  maxPlayers: number;
  supportsPrivateRooms: boolean;
  supportsMatchmaking: boolean;
  supportsReconnection: boolean;
}
export interface MultiplayerAdapter<State = RaceState> {
  capabilities: MultiplayerCapabilities;
  initialState(slot: number): State;
  simulate(state: State, input: RaceInput, dt: number): number | null;
}
export type PresenceStatus = 'online' | 'inGame' | 'inLobby' | 'away' | 'offline';
export interface Presence {
  status: PresenceStatus;
  roomId?: string;
  gameId?: string;
  joinable?: boolean;
}
export const multiplayerActionSchema = z
  .object({
    action: z.enum(['create', 'join', 'quick', 'cancel', 'status', 'heartbeat', 'authorizeInvite']),
    gameId: z.string().max(64).optional(),
    roomId: z.string().max(64).optional(),
    code: z
      .string()
      .regex(/^[A-Z0-9]{6}$/)
      .optional(),
    private: z.boolean().optional(),
    maxPlayers: z.number().int().min(2).max(6).optional(),
    activity: z.boolean().optional(),
    party: z.boolean().optional(),
  })
  .strict();
export type MultiplayerAction = z.infer<typeof multiplayerActionSchema>;
