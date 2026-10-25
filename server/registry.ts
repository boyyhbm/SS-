import { NexusRaceRoom } from './race-room';
// Reviewed code imports only. An admin cannot provide a class name, file path or executable build.
export const registeredGameServers = {
  'midnight-outlaws': { roomName: 'nexus_race', Room: NexusRaceRoom },
};
export function gameServerAdapter(runtimeKey: string) {
  return registeredGameServers[runtimeKey as keyof typeof registeredGameServers];
}
