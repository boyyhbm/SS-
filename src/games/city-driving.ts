import { stepVehicleMotion, drivingTuning } from './vehicle-motion';
export { drivingTuning, steeringAngle } from './vehicle-motion';
import { vehicleDimensions, type VehicleId } from './vehicles/config';
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
  impactYaw: number;
  collisionImpulse: number;
}
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
    impactYaw: 0,
    collisionImpulse: 0,
  };
}
const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0));
export function citySurfaceIsDriveable(p: Point) {
  return roadClearance(p) >= drivingTuning.carRadius;
}
export function carClearance(p: Point, heading: number, vehicleId?: VehicleId) {
  const dims = vehicleDimensions(vehicleId);
  let clearance = Infinity;
  for (const offset of [-dims.halfSpine, 0, dims.halfSpine]) {
    const q = { x: p.x + Math.sin(heading) * offset, z: p.z + Math.cos(heading) * offset };
    clearance = Math.min(clearance, roadClearance(q) - dims.radius);
    for (const c of cityParkedCars) {
      const dx = q.x - c.x,
        dz = q.z - c.z,
        x = Math.abs(dx * Math.cos(c.heading) - dz * Math.sin(c.heading)) - 1.03,
        z = Math.abs(dx * Math.sin(c.heading) + dz * Math.cos(c.heading)) - 2.3;
      const d =
        Math.hypot(Math.max(0, x), Math.max(0, z)) + Math.min(Math.max(x, z), 0) - dims.radius;
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
  laps = getCityRoute(s.routeId).laps,
): number | null {
  dt = clamp(dt, 0, 0.05);
  if (!dt) return null;
  const previous = stepVehicleMotion(
    s,
    input,
    dt,
    (x, z, heading) => carClearance({ x, z }, heading, s.vehicleId),
    freeDrive,
  );
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
        s.finished = r.kind === 'sprint' || s.lap > laps;
        return time;
      }
      s.nextCheckpoint++;
    }
  }
  return null;
}
