export const TRACK_RADIUS = 95,
  ROAD_HALF_WIDTH = 12;
export interface RaceInput {
  throttle: number;
  brake: number;
  steer: number;
  nitro: boolean;
  handbrake?: boolean;
}
export interface RaceState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  vx: number;
  vz: number;
  steering: number;
  nitro: number;
  nextCheckpoint: number;
  lap: number;
  lapTime: number;
  bestLap: number | null;
  collision: boolean;
}
export function initialRace(): RaceState {
  return {
    x: TRACK_RADIUS,
    z: 1,
    heading: 0,
    speed: 0,
    vx: 0,
    vz: 0,
    steering: 0,
    nitro: 100,
    nextCheckpoint: 1,
    lap: 1,
    lapTime: 0,
    bestLap: null,
    collision: false,
  };
}
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
export function stepRace(state: RaceState, input: RaceInput, dt: number): number | null {
  dt = clamp(dt, 0, 0.05);
  state.lapTime += dt;
  state.collision = false;
  state.steering += (clamp(input.steer, -1, 1) - state.steering) * Math.min(1, dt * 8);
  const boost = input.nitro && state.nitro > 0 && input.throttle > 0;
  state.nitro = clamp(state.nitro + (boost ? -30 : 9) * dt, 0, 100);
  const acceleration =
    input.throttle * (boost ? 34 : 22) -
    input.brake * 38 -
    (input.handbrake ? 50 : 0) -
    3.2 -
    state.speed * 0.065;
  state.speed = clamp(state.speed + acceleration * dt, 0, boost ? 67 : 48);
  state.heading -=
    state.steering * (input.handbrake ? 1.5 : 1.12) * clamp(state.speed / 14, 0, 1) * dt;
  const grip = Math.min(1, dt * (input.handbrake ? 2.8 : boost ? 4.2 : 6));
  state.vx += (Math.sin(state.heading) * state.speed - state.vx) * grip;
  state.vz += (Math.cos(state.heading) * state.speed - state.vz) * grip;
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  const radius = Math.hypot(state.x, state.z);
  const inner = TRACK_RADIUS - ROAD_HALF_WIDTH + 1,
    outer = TRACK_RADIUS + ROAD_HALF_WIDTH - 1;
  if (radius < inner || radius > outer) {
    const bound = clamp(radius, inner, outer);
    state.x = (state.x / radius) * bound;
    state.z = (state.z / radius) * bound;
    state.speed *= 0.65;
    state.vx *= 0.6;
    state.vz *= 0.6;
    state.collision = true;
  }
  const angle = ((Math.atan2(state.z, state.x) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const target = ((state.nextCheckpoint % 4) * Math.PI) / 2;
  const angularDistance = Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)));
  const forward = Math.cos(state.heading + angle) > 0.4;
  if (angularDistance < 0.14 && state.speed > 3 && forward) {
    if (state.nextCheckpoint === 4) {
      const lap = state.lapTime;
      state.bestLap = state.bestLap === null ? lap : Math.min(state.bestLap, lap);
      state.lap++;
      state.lapTime = 0;
      state.nextCheckpoint = 1;
      return lap;
    }
    state.nextCheckpoint++;
  }
  return null;
}
export function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
