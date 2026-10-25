import { initialRace, stepRace } from '../games/racing-physics';
import type { MultiplayerAdapter } from './contracts';
export const multiplayerAdapters: Record<string, MultiplayerAdapter> = {
  'midnight-outlaws': {
    capabilities: {
      singlePlayer: true,
      onlineMultiplayer: true,
      localMultiplayer: false,
      coop: false,
      competitive: true,
      maxPlayers: 6,
      supportsPrivateRooms: true,
      supportsMatchmaking: true,
      supportsReconnection: true,
    },
    initialState(slot) {
      // Ghost racing: cars do not collide. Stagger grid without changing checkpoint ordering.
      return { ...initialRace(), x: 92 + (slot % 2) * 5, z: -Math.floor(slot / 2) * 5 };
    },
    simulate: stepRace,
  },
};
