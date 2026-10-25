import { type RaceState, type RaceInput } from './racing-physics';
import {
  getCityRoute,
  roadClearance,
  cityParkedCars,
  type CityRouteId,
  type Point,
} from './road-network';
export interface CityRaceState extends RaceState {
  routeId: CityRouteId;
  finished: boolean;
  driveThrottle: number;
  brakePressure: number;
  reverseTimer: number;
}
export const drivingTuning = {
  wheelbase: 2.8,
  steeringResponse: 7.5,
  throttleResponse: 5,
  brakeResponse: 10,
  engineAcceleration: 10,
  boostAcceleration: 17,
  braking: 22,
  handbrake: 13,
  topSpeed: 54,
  boostTopSpeed: 68,
  carRadius: 1.05,
};
export function initialCityRace(routeId: CityRouteId): CityRaceState {
  const r = getCityRoute(routeId);
  return {
    ...r.start,
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
    routeId,
    finished: false,
    driveThrottle: 0,
    brakePressure: 0,
    reverseTimer: 0,
  };
}
const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0));
export function steeringAngle(speed: number) {
  return 0.52 / (1 + Math.abs(speed) / 14);
}
export function citySurfaceIsDriveable(p: Point) {
  return roadClearance(p) >= drivingTuning.carRadius;
}
export function carClearance(p: Point, heading: number) {
  let clearance = Infinity;
  for (const offset of [-1.25, 0, 1.25]) {
    const q = { x: p.x + Math.sin(heading) * offset, z: p.z + Math.cos(heading) * offset };
    clearance = Math.min(clearance, roadClearance(q) - drivingTuning.carRadius);
    for (const c of cityParkedCars) {
      const dx = q.x - c.x,
        dz = q.z - c.z,
        x = Math.abs(dx * Math.cos(c.heading) - dz * Math.sin(c.heading)) - 1.03,
        z = Math.abs(dx * Math.sin(c.heading) + dz * Math.cos(c.heading)) - 2.3;
      const d =
        Math.hypot(Math.max(0, x), Math.max(0, z)) +
        Math.min(Math.max(x, z), 0) -
        drivingTuning.carRadius;
      clearance = Math.min(clearance, d);
    }
  }
  return clearance;
}
export function stepCityRace(
  s: CityRaceState,
  input: RaceInput,
  dt: number,
  freeDrive = false,
): number | null {
  dt = clamp(dt, 0, 0.05);
  if (!dt) return null;
  const tune = drivingTuning,
    previous = { x: s.x, z: s.z },
    previousHeading = s.heading;
  s.collision = false;
  if (!s.finished) s.lapTime += dt;
  const throttle = s.finished && !freeDrive ? 0 : clamp(input.throttle, 0, 1),
    brake = s.finished && !freeDrive ? 1 : clamp(input.brake, 0, 1),
    handbrake = !!input.handbrake;
  s.driveThrottle += (throttle - s.driveThrottle) * (1 - Math.exp(-dt * tune.throttleResponse));
  s.brakePressure += (brake - s.brakePressure) * (1 - Math.exp(-dt * tune.brakeResponse));
  s.steering +=
    (clamp(input.steer, -1, 1) - s.steering) * (1 - Math.exp(-dt * tune.steeringResponse));
  const boost = !!input.nitro && s.nitro > 0 && s.driveThrottle > 0.2 && s.speed > 1;
  s.nitro = clamp(s.nitro + (boost ? -27 : 8) * dt, 0, 100);
  if (s.speed < 0.3 && brake > 0.6 && throttle < 0.05) s.reverseTimer += dt;
  else if (s.speed >= 0.3 || throttle > 0.1 || brake < 0.1) s.reverseTimer = 0;
  const reverse = s.reverseTimer > 0.4 && brake > 0.1 && throttle < 0.05;
  let force = 0;
  if (reverse) force = -brake * 5;
  else if (s.speed < -0.1 && throttle > 0.1) force = throttle * tune.braking;
  else
    force =
      s.driveThrottle * (boost ? tune.boostAcceleration : tune.engineAcceleration) -
      (s.speed > 0 ? s.brakePressure * tune.braking : 0);
  const resistance =
    (0.8 + 0.0055 * s.speed * s.speed) * (s.speed < 0 ? -1 : 1) +
    (handbrake ? tune.handbrake * Math.sign(s.speed) : 0);
  const next = s.speed + (force - resistance) * dt;
  s.speed = clamp(
    !reverse && s.speed >= 0 ? Math.max(0, next) : reverse ? Math.min(0, next) : next,
    -9,
    boost ? tune.boostTopSpeed : tune.topSpeed,
  );
  if (!reverse && s.driveThrottle < 0.01 && s.speed < 0.04 && s.speed > -0.04) s.speed = 0;
  const yaw = clamp(
    (s.speed / tune.wheelbase) *
      Math.tan(s.steering * steeringAngle(s.speed)) *
      (handbrake ? 1.22 : 1),
    -1.35,
    1.35,
  );
  s.heading -= yaw * dt;
  const grip = 1 - Math.exp(-dt * (handbrake ? 3.2 : Math.max(7, 14 - Math.abs(s.speed) * 0.1)));
  s.vx += (Math.sin(s.heading) * s.speed - s.vx) * grip;
  s.vz += (Math.cos(s.heading) * s.speed - s.vz) * grip;
  const intended = { x: s.x + s.vx * dt, z: s.z + s.vz * dt };
  if (carClearance(intended, s.heading) < 0 && carClearance(previous, previousHeading) >= 0) {
    // Continuous swept motion to the curb: no radial snapping or repeated velocity
    // multiplication. Remove only outward velocity so glancing impacts can slide.
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 9; i++) {
      const t = (lo + hi) / 2;
      if (
        carClearance(
          {
            x: previous.x + (intended.x - previous.x) * t,
            z: previous.z + (intended.z - previous.z) * t,
          },
          s.heading,
        ) >= 0
      )
        lo = t;
      else hi = t;
    }
    s.x = previous.x + (intended.x - previous.x) * lo;
    s.z = previous.z + (intended.z - previous.z) * lo;
    if (carClearance(s, s.heading) < 0) s.heading = previousHeading;
    const dx =
        carClearance({ x: s.x + 0.08, z: s.z }, s.heading) -
        carClearance({ x: s.x - 0.08, z: s.z }, s.heading),
      dz =
        carClearance({ x: s.x, z: s.z + 0.08 }, s.heading) -
        carClearance({ x: s.x, z: s.z - 0.08 }, s.heading),
      len = Math.hypot(dx, dz) || 1,
      nx = dx / len,
      nz = dz / len,
      dot = s.vx * nx + s.vz * nz;
    if (dot < 0) {
      s.vx -= nx * dot * 1.08;
      s.vz -= nz * dot * 1.08;
    }
    s.speed = (s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading)) * 0.85;
    s.collision = true;
  } else {
    s.x = intended.x;
    s.z = intended.z;
  }
  if (freeDrive || s.finished) return null;
  const r = getCityRoute(s.routeId),
    g = r.gates[s.nextCheckpoint - 1];
  const before = (previous.x - g.x) * g.tx + (previous.z - g.z) * g.tz,
    after = (s.x - g.x) * g.tx + (s.z - g.z) * g.tz;
  if (before <= 0 && after > 0 && s.vx * g.tx + s.vz * g.tz > 1) {
    const t = before / (before - after),
      x = previous.x + (s.x - previous.x) * t - g.x,
      z = previous.z + (s.z - previous.z) * t - g.z;
    if (Math.abs(x * -g.tz + z * g.tx) <= g.halfWidth) {
      if (s.nextCheckpoint === r.gates.length) {
        const time = s.lapTime;
        s.bestLap = s.bestLap === null ? time : Math.min(s.bestLap, time);
        s.lap++;
        s.nextCheckpoint = 1;
        s.lapTime = 0;
        s.finished = r.kind === 'sprint' || s.lap > r.laps;
        return time;
      }
      s.nextCheckpoint++;
    }
  }
  return null;
}
