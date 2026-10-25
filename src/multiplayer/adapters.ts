import { initialNetworkRace, stepNetworkRace, simulateNetworkGroup } from '../games/network-racing';
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
    initialState: initialNetworkRace,
    simulate: stepNetworkRace,
    simulateGroup: simulateNetworkGroup,
  },
};
