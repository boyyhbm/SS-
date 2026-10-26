import type { RaceInput } from '../racing-physics';
import { stepVehicleMotion, type VehicleMotionState } from '../vehicle-motion';
import { configureVehicle } from '../vehicles/state';
import { DEFAULT_VEHICLE, vehicleDimensions, type VehicleId } from '../vehicles/config';
import { getTrack, type TrackId } from './registry';
import { projectRoad } from './geometry';
export interface TrackRaceState extends VehicleMotionState {
  routeId: TrackId;
  y: number;
  roadPitch: number;
  roadBank: number;
}
export function initialTrackRace(
  routeId: TrackId,
  vehicleId: VehicleId = DEFAULT_VEHICLE,
): TrackRaceState {
  const t = getTrack(routeId);
  return configureVehicle(
    {
      ...t.start,
      routeId,
      roadPitch: 0,
      roadBank: 0,
      finished: false,
      driveThrottle: 0,
      brakePressure: 0,
      reverseTimer: 0,
      impactYaw: 0,
      collisionImpulse: 0,
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
    },
    vehicleId,
  );
}
export function trackCarClearance(
  routeId: TrackId,
  x: number,
  z: number,
  heading: number,
  vehicleId?: VehicleId,
) {
  const road = getTrack(routeId).roadColliders,
    dims = vehicleDimensions(vehicleId);
  let clearance = Infinity;
  for (const offset of [-dims.halfSpine, 0, dims.halfSpine]) {
    const p = projectRoad(road, x + Math.sin(heading) * offset, z + Math.cos(heading) * offset);
    clearance = Math.min(clearance, p.clearance - dims.radius);
  }
  return clearance;
}
export function stepTrackRace(
  s: TrackRaceState,
  input: RaceInput,
  dt: number,
  freeDrive = false,
  laps = getTrack(s.routeId).laps,
): number | null {
  dt = Math.max(0, Math.min(0.05, dt));
  if (!dt) return null;
  const track = getTrack(s.routeId),
    road = track.roadGeometry;
  const surface = projectRoad(road, s.x, s.z),
    grade = surface.gradientX * Math.sin(s.heading) + surface.gradientZ * Math.cos(s.heading);
  const previous = stepVehicleMotion(
    s,
    input,
    dt,
    (x, z, h) => trackCarClearance(s.routeId, x, z, h, s.vehicleId),
    freeDrive,
    Math.sin(Math.atan(grade)),
    surface.grip,
  );
  const next = projectRoad(road, s.x, s.z);
  s.y = next.height;
  s.roadPitch = Math.atan(
    next.gradientX * Math.sin(s.heading) + next.gradientZ * Math.cos(s.heading),
  );
  s.roadBank = Math.atan(
    next.gradientX * Math.cos(s.heading) - next.gradientZ * Math.sin(s.heading),
  );
  if (freeDrive || s.finished) return null;
  const gate = track.checkpoints[s.nextCheckpoint - 1];
  const before = (previous.x - gate.x) * gate.tx + (previous.z - gate.z) * gate.tz,
    after = (s.x - gate.x) * gate.tx + (s.z - gate.z) * gate.tz;
  if (before <= 0 && after > 0 && s.vx * gate.tx + s.vz * gate.tz > 1) {
    const t = before / (before - after),
      x = previous.x + (s.x - previous.x) * t - gate.x,
      z = previous.z + (s.z - previous.z) * t - gate.z;
    if (Math.abs(-x * gate.tz + z * gate.tx) <= gate.halfWidth) {
      if (s.nextCheckpoint === track.checkpoints.length) {
        const seconds = s.lapTime;
        s.bestLap = Math.min(s.bestLap ?? Infinity, seconds);
        s.lap++;
        s.nextCheckpoint = 1;
        s.lapTime = 0;
        s.finished = track.kind === 'sprint' || s.lap > laps;
        return seconds;
      }
      s.nextCheckpoint++;
    }
  }
  return null;
}
