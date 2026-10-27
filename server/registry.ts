import { NexusRaceRoom } from './race-room';
import { NexusFoldRoom } from './fold-room';
// Reviewed code imports only. An admin cannot provide a class name, file path or executable build.
export const registeredGameServers = {
  'midnight-outlaws': {
    roomName: 'nexus_race',
    Room: NexusRaceRoom,
    maxPlayers: 6,
    raceRoutes: true,
  },
  'fold-zero': { roomName: 'nexus_fold', Room: NexusFoldRoom, maxPlayers: 2, raceRoutes: false },
};
export function gameServerAdapter(runtimeKey: string) {
  return registeredGameServers[runtimeKey as keyof typeof registeredGameServers];
}
