import { neutralCommand, type ForgeCommand, type ForgeState } from '../../src/games/fold/contracts';
export interface DuelDriver {
  round: number;
  index: number;
  points: { x: number; z: number }[];
  foldStage: boolean;
  folded: boolean;
}
export const newDuelDriver = (): DuelDriver => ({
  round: 0,
  index: 0,
  points: [],
  foldStage: false,
  folded: false,
});
// QA input fixture only: reads the real client's state and emits ordinary
// movement/aim/actions. Never writes a player transform, health or a result.
export function driveDuel(
  state: ForgeState,
  id: string,
  driver: DuelDriver,
  attacker: boolean,
  exerciseFold = false,
): Omit<ForgeCommand, 'seq'> {
  const p = state.players.find((p) => p.id === id)!,
    other = state.players.find((p) => p.id !== id)!;
  const command = { ...neutralCommand(), aimTick: state.tick, yaw: p.yaw, pitch: p.pitch };
  if (!['active', 'overtime'].includes(state.phase)) return command;
  if (driver.round !== state.round) {
    driver.round = state.round;
    driver.index = 0;
    driver.foldStage = exerciseFold && state.round === 1;
    const sign = p.z > 0 ? 1 : -1;
    driver.points = driver.foldStage
      ? [
          { x: -3.5, z: 13 },
          { x: -3.5, z: 6 },
          { x: -6, z: 6 },
        ]
      : [
          { x: 19.5, z: sign * 13 },
          { x: 19.5, z: sign * 4 },
        ];
  }
  const target = driver.points[driver.index];
  if (target) {
    const dx = target.x - p.x,
      dz = target.z - p.z,
      distance = Math.hypot(dx, dz);
    if (distance < 0.32) driver.index++;
    else {
      command.yaw = Math.atan2(-dx, -dz);
      command.pitch = 0;
      command.moveZ = -Math.min(1, distance / 1.2);
      return command;
    }
  }
  if (driver.index < driver.points.length) return command;
  if (driver.foldStage) {
    const n = state.nodes[0];
    if (n.state === 1) {
      driver.folded = true;
      driver.foldStage = false;
      driver.points = [
        { x: -3.5, z: 6 },
        { x: -3.5, z: 13 },
        { x: 19.5, z: 13 },
        { x: 19.5, z: 4 },
      ];
      driver.index = 0;
      return command;
    }
    command.yaw = 0;
    command.pitch = -0.17;
    command.fold = true;
    return command;
  }
  const dx = other.x - p.x,
    dz = other.z - p.z;
  command.yaw = Math.atan2(-dx, -dz);
  command.pitch = Math.atan2(other.y - p.y, Math.hypot(dx, dz));
  command.fire = attacker && Math.abs(other.x - 19.5) < 0.6 && Math.abs(other.z) < 5;
  command.reload = p.ammo === 0;
  return command;
}
