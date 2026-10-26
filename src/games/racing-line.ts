import { getRoute, isCityRoute, type RouteId } from './route-registry';
import { roadClearance, closestOnPolyline, distance, type Point } from './road-network';
import { getVehicle, type VehicleId } from './vehicles/config';
import { getTrack, isTrackId } from './tracks/registry';
import { projectRoad } from './tracks/geometry';
export type RacingLineMode = 'off' | 'corners' | 'full';
export type LineSample = Point & {
  y?: number;
  tx: number;
  tz: number;
  s: number;
  curvature: number;
  safeSpeed: number;
  targetSpeed: number;
  braking?: number;
};
export const assistTuning = {
  grip: 0.85,
  lateralAcceleration: 5.5,
  braking: 15,
  reactionSeconds: 0.7,
  maxSpeed: 48,
};
const cache = new Map<string, { samples: LineSample[]; length: number; closed: boolean }>();
export function buildRacingLine(id: RouteId, vehicleId?: VehicleId) {
  const key = id + ':' + (vehicleId ?? 'legacy');
  const cached = cache.get(key);
  if (cached) return cached;
  const r = getRoute(id);
  const vehicle = vehicleId ? getVehicle(vehicleId) : null;
  const road = isTrackId(id) ? getTrack(id).roadGeometry : null;
  const braking = vehicle ? (vehicle.brakeForce / vehicle.mass) * 0.78 : assistTuning.braking;
  const grip = vehicle?.tireGrip ?? assistTuning.grip;
  const maxSpeed = vehicle
    ? (vehicle.maxRPM / (vehicle.gearRatios.at(-1)! * vehicle.finalDrive) / 60) *
      Math.PI *
      2 *
      vehicle.wheelRadius
    : assistTuning.maxSpeed;
  let path = r.geometry;
  if (road && r.kind === 'sprint') {
    const start = closestOnPolyline(r.start, path);
    path = [r.start, ...path.slice(start.index + 1)];
  }
  if (r.kind === 'sprint') {
    const at = closestOnPolyline(r.finish, path);
    path = [...path.slice(0, at.index + 1), r.finish];
  }
  const points: Point[] = [];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      len = distance(a, b);
    if (len < 1e-5) continue;
    for (let d = carry; d < len; d += 2.5)
      points.push({ x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len });
    carry = (carry - len) % 2.5;
    if (carry < 0) carry += 2.5;
  }
  if (r.kind === 'sprint') points.push(r.finish);
  for (let pass = 0; pass < 5; pass++) {
    const before = points.map((p) => ({ ...p }));
    for (let i = 0; i < points.length; i++) {
      if (r.kind === 'sprint' && (i === 0 || i === points.length - 1)) continue;
      const a = before[(i - 1 + before.length) % before.length],
        p = before[i],
        b = before[(i + 1) % before.length],
        q = { x: (a.x + p.x * 2 + b.x) / 4, z: (a.z + p.z * 2 + b.z) / 4 };
      if (
        road
          ? projectRoad(road, q.x, q.z).clearance > 2.3
          : !isCityRoute(id) || roadClearance(q) > 2.3
      )
        points[i] = q;
    }
  }
  let total = 0;
  const samples: LineSample[] = points.map((p, i) => {
    const a =
        points[r.kind === 'circuit' ? (i - 2 + points.length) % points.length : Math.max(0, i - 2)],
      b =
        points[r.kind === 'circuit' ? (i + 2) % points.length : Math.min(points.length - 1, i + 2)];
    const len = distance(a, b) || 1;
    if (i) total += distance(points[i - 1], p);
    const ab = distance(a, p),
      bc = distance(p, b),
      cross = Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x));
    const curvature = (2 * cross) / Math.max(0.001, ab * bc * len);
    const surface = road ? projectRoad(road, p.x, p.z) : null;
    const grade = surface
      ? (surface.gradientX * (b.x - a.x)) / len + (surface.gradientZ * (b.z - a.z)) / len
      : 0;
    const localBraking = Math.max(
      2,
      braking * (surface?.grip ?? 1) + 9.81 * Math.sin(Math.atan(grade)),
    );
    const safeSpeed = Math.min(
      maxSpeed,
      Math.sqrt(
        (assistTuning.lateralAcceleration * grip * (surface?.grip ?? 1)) /
          Math.max(0.0001, curvature),
      ),
      1.1 / Math.max(0.0001, curvature),
    );
    return {
      ...p,
      y: surface?.height ?? 0,
      tx: (b.x - a.x) / len,
      tz: (b.z - a.z) / len,
      s: total,
      curvature,
      safeSpeed,
      targetSpeed: safeSpeed,
      braking: localBraking,
    };
  });
  if (r.kind === 'circuit') total += distance(points.at(-1)!, points[0]);
  for (let pass = 0; pass < 3; pass++)
    for (let i = samples.length - 1; i >= 0; i--) {
      if (i === samples.length - 1 && r.kind === 'sprint') continue;
      const next = samples[(i + 1) % samples.length];
      samples[i].targetSpeed = Math.min(
        samples[i].targetSpeed,
        Math.sqrt(next.targetSpeed ** 2 + 2 * samples[i].braking! * distance(samples[i], next)),
      );
    }
  const result = { samples, length: total, closed: r.kind === 'circuit' };
  cache.set(key, result);
  return result;
}
export function racingLineColor(speed: number, sample: LineSample, ahead: number) {
  const allowed = Math.sqrt(
    sample.targetSpeed ** 2 +
      2 *
        (sample.braking ?? assistTuning.braking) *
        Math.max(0, ahead - Math.abs(speed) * assistTuning.reactionSeconds),
  );
  const ratio = Math.abs(speed) / Math.max(3, allowed);
  return ratio > 1.04 ? 'red' : ratio > 0.88 ? 'yellow' : 'green';
}
export function assistAhead(sample: LineSample, progress: number, length: number, closed: boolean) {
  let d = sample.s - progress;
  if (closed && d < -8) d += length;
  return d;
}
