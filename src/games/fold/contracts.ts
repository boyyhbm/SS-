import { z } from 'zod';
export const foldCommandSchema = z
  .object({
    seq: z.number().int().min(0).max(2147483647),
    aimTick: z.number().int().min(0).max(2147483647),
    moveX: z.number().finite().min(-1).max(1),
    moveZ: z.number().finite().min(-1).max(1),
    yaw: z.number().finite().min(-Math.PI).max(Math.PI),
    pitch: z.number().finite().min(-1.45).max(1.45),
    fire: z.boolean(),
    aim: z.boolean(),
    sprint: z.boolean(),
    jump: z.boolean(),
    slide: z.boolean(),
    reload: z.boolean(),
    fold: z.boolean(),
    impulse: z.boolean(),
  })
  .strict();
export type ForgeCommand = z.infer<typeof foldCommandSchema>;
export const neutralCommand = (seq = 0): ForgeCommand => ({
  seq,
  aimTick: 0,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  fire: false,
  aim: false,
  sprint: false,
  jump: false,
  slide: false,
  reload: false,
  fold: false,
  impulse: false,
});
export interface ForgePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}
export interface ForgePlayer extends ForgePose {
  id: string;
  slot: number;
  hp: number;
  ammo: number;
  reload: number;
  shot: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  slide: number;
  slideReady: number;
  foldCharges: number;
  impulseReady: number;
  capture: number;
  damage: number;
  holdingNode: string | null;
  foldHold: number;
  impulseX: number;
  impulseZ: number;
}
export type FoldNodePhase = 'idle' | 'warning' | 'moving';
export interface FoldNodeState {
  id: string;
  state: 0 | 1;
  target: 0 | 1;
  phase: FoldNodePhase;
  progress: number;
  until: number;
  availableAt: number;
  activator: string | null;
}
export type ForgePhase = 'prepare' | 'active' | 'overtime' | 'round-end' | 'finished';
export interface ForgeEvent {
  id: number;
  tick: number;
  type:
    | 'shot'
    | 'hit'
    | 'reload'
    | 'jump'
    | 'land'
    | 'slide'
    | 'fold'
    | 'fold-cancel'
    | 'impulse'
    | 'round'
    | 'core';
  playerId?: string;
  targetId?: string;
  x: number;
  y: number;
  z: number;
}
export interface ForgeState {
  tick: number;
  phase: ForgePhase;
  round: number;
  score: [number, number];
  phaseStarted: number;
  roundStarted: number;
  winner: string | null;
  roundWinner: string | null;
  reason: string;
  players: ForgePlayer[];
  nodes: FoldNodeState[];
  events: ForgeEvent[];
}
export interface ForgeSnapshot {
  protocol: number;
  roomId: string;
  code: string;
  gameId: string;
  leaderId: string;
  phase: 'lobby' | 'countdown' | 'racing' | 'results';
  private: boolean;
  serverTime: number;
  matchId: string | null;
  saved: boolean;
  players: {
    id: string;
    username: string;
    slot: number;
    connected: boolean;
    ready: boolean;
    ack: number;
  }[];
  game: ForgeState | null;
}
