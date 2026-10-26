import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '../src/multiplayer/contracts';
import { initialNetworkRace } from '../src/games/network-racing';
import { selectRoute } from '../src/games/route-registry';
import { RacePrediction } from '../src/multiplayer/prediction';
const mock = vi.hoisted(() => {
  const handlers = new Map<string, (data: unknown) => void>();
  const room = {
    connection: { isOpen: true },
    reconnection: {} as Record<string, unknown>,
    onMessage: (name: string, fn: (value: unknown) => void) => handlers.set(name, fn),
    onDrop: () => {},
    onReconnect: () => {},
    onLeave: () => {},
    send: () => {},
    leave: async () => {},
  };
  return { room, handlers };
});
vi.mock('@colyseus/sdk', () => ({
  Client: class {
    async consumeSeatReservation() {
      return mock.room;
    }
  },
}));
import { NexusMultiplayerSDK } from '../src/multiplayer/sdk';
const snapshot = (tick: number): RoomSnapshot => ({
  roomId: 'room',
  code: 'ABCDEF',
  gameId: 'game',
  leaderId: 'a',
  phase: 'lobby',
  region: 'europe',
  mode: 'circuit',
  route: selectRoute('downtown-circuit'),
  private: true,
  maxPlayers: 2,
  laps: 3,
  serverTime: 1000 + tick,
  tick,
  startsAt: null,
  matchId: null,
  saved: false,
  players: [
    {
      id: 'a',
      username: 'Alice',
      avatar: 'violet',
      car: 'silver',
      ready: false,
      connected: true,
      state: initialNetworkRace(0, selectRoute('downtown-circuit')),
      ack: -1,
      finish: null,
      place: null,
    },
  ],
});
beforeEach(() => {
  vi.useFakeTimers();
  mock.handlers.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ reservation: {}, endpoint: 'ws://localhost', userId: 'a' }),
    })),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('coalesces a queued socket burst to its newest state before prediction and UI work', async () => {
  const sdk = new NexusMultiplayerSDK((id, send) => new RacePrediction(id, send));
  await sdk.createRoom('game');
  const receive = vi.spyOn(sdk.prediction!, 'receive'),
    updates = vi.fn();
  sdk.receiveState(updates);
  for (let tick = 0; tick < 20; tick++) mock.handlers.get('snapshot')!(snapshot(tick));
  mock.handlers.get('snapshot')!(snapshot(3));
  expect(receive).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(updates).toHaveBeenCalledTimes(1);
  expect(sdk.latestSnapshot?.tick).toBe(19);
  mock.handlers.get('snapshot')!(snapshot(20));
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledTimes(2);
  await sdk.leaveRoom();
});
it('cancels pending state on leave so a previous room cannot repopulate a closed session', async () => {
  const sdk = new NexusMultiplayerSDK((id, send) => new RacePrediction(id, send));
  await sdk.createRoom('game');
  const receive = vi.spyOn(sdk.prediction!, 'receive');
  mock.handlers.get('snapshot')!(snapshot(10));
  await sdk.leaveRoom();
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
  expect(sdk.latestSnapshot).toBe(null);
  expect(sdk.connected).toBe(false);
});
