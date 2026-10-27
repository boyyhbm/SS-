import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Client } from '@colyseus/core';
import { initialNetworkRace } from '../src/games/network-racing';
import { selectRoute } from '../src/games/route-registry';
import { VEHICLE_VERSION } from '../src/games/vehicles/config';
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (client: Client, data: unknown) => void>(),
}));
vi.mock('@colyseus/core', () => ({
  Room: class {
    roomId = 'selection-test';
    clock = { setInterval: () => {}, setTimeout: () => {} };
    setSeatReservationTime() {}
    setSimulationInterval() {}
    broadcast() {}
    onMessage(name: string, handler: (client: Client, data: unknown) => void) {
      mock.handlers.set(name, handler);
    }
  },
}));
vi.mock('../src/lib/db', () => ({ db: {} }));
vi.mock('../server/token', () => ({
  verifyConnectionToken: () => ({ sub: 'owner', kind: 'control' }),
  signConnectionToken: () => 'unused',
}));
import { NexusRaceRoom } from '../server/race-room';
import { liveRooms } from '../server/state';
let room: NexusRaceRoom;
const client = { auth: { sub: 'owner' } } as Client;
beforeEach(() => {
  mock.handlers.clear();
  room = new NexusRaceRoom();
  room.onCreate({
    ownerId: 'owner',
    gameId: 'game',
    runtimeKey: 'midnight-outlaws',
    private: true,
    maxPlayers: 2,
    creationToken: 'fixture',
    routeId: 'downtown-circuit',
  });
  room.players.set('owner', {
    id: 'owner',
    username: 'Driver',
    avatar: 'violet',
    car: 'cyan',
    vehicleId: 'pocket-gt',
    vehicleVersion: VEHICLE_VERSION,
    ready: true,
    connected: true,
    state: initialNetworkRace(0, selectRoute('downtown-circuit'), 'pocket-gt'),
    ack: -1,
    finish: null,
    place: null,
    latest: null,
    lastInputAt: 0,
    received: -1,
    strikes: 0,
    sessionId: 'session',
    departed: false,
    connectedSeconds: 0,
  });
});
afterEach(() => liveRooms.clear());
it('keeps readiness and simulation state when delayed preference messages repeat the same selection', () => {
  const player = room.players.get('owner')!;
  player.state.speed = 7;
  const before = structuredClone(player.state);
  mock.handlers.get('vehicle')!(client, {
    vehicleId: 'pocket-gt',
    vehicleVersion: VEHICLE_VERSION,
  });
  mock.handlers.get('car')!(client, 'cyan');
  expect(player.ready).toBe(true);
  expect(player.state).toEqual(before);
});
it('requires readiness again after an actual vehicle or body color change', () => {
  const player = room.players.get('owner')!;
  mock.handlers.get('vehicle')!(client, { vehicleId: 'iron-v8', vehicleVersion: VEHICLE_VERSION });
  expect(player.ready).toBe(false);
  expect(player.state.vehicleId).toBe('iron-v8');
  mock.handlers.get('ready')!(client, true);
  mock.handlers.get('car')!(client, 'violet');
  expect(player.ready).toBe(false);
  expect(player.car).toBe('violet');
});
it('still rejects physical overrides, unknown vehicles and changes during a race', () => {
  const player = room.players.get('owner')!;
  mock.handlers.get('vehicle')!(client, {
    vehicleId: 'nova-x',
    vehicleVersion: VEHICLE_VERSION,
    mass: 1,
  });
  mock.handlers.get('vehicle')!(client, { vehicleId: 'invented', vehicleVersion: VEHICLE_VERSION });
  expect(player.vehicleId).toBe('pocket-gt');
  expect(player.ready).toBe(true);
  room.phase = 'racing';
  mock.handlers.get('vehicle')!(client, { vehicleId: 'nova-x', vehicleVersion: VEHICLE_VERSION });
  mock.handlers.get('car')!(client, 'violet');
  expect(player.vehicleId).toBe('pocket-gt');
  expect(player.car).toBe('cyan');
});
