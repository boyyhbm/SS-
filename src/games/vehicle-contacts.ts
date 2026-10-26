import type { CityRaceState } from './city-driving';
import { carClearance } from './city-driving';
import { contactTuning } from './contact-physics';
import { vehicleDimensions } from './vehicles/config';
// Closest points of two finite capsule spines (Ericson segment/segment method).
function closest(a: CityRaceState, b: CityRaceState) {
  const ad = vehicleDimensions(a.vehicleId),
    bd = vehicleDimensions(b.vehicleId);
  const ax = Math.sin(a.heading) * ad.halfSpine * 2,
    az = Math.cos(a.heading) * ad.halfSpine * 2,
    bx = Math.sin(b.heading) * bd.halfSpine * 2,
    bz = Math.cos(b.heading) * bd.halfSpine * 2,
    ox = a.x - ax / 2 - b.x + bx / 2,
    oz = a.z - az / 2 - b.z + bz / 2,
    aa = ax * ax + az * az,
    bb = bx * bx + bz * bz,
    ab = ax * bx + az * bz,
    ao = ax * ox + az * oz,
    bo = bx * ox + bz * oz,
    den = aa * bb - ab * ab;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  let s = den > 1e-8 ? clamp((ab * bo - ao * bb) / den) : 0;
  let t = (ab * s + bo) / bb;
  if (t < 0) {
    t = 0;
    s = clamp(-ao / aa);
  } else if (t > 1) {
    t = 1;
    s = clamp((ab - ao) / aa);
  }
  return {
    ax: a.x + ax * (s - 0.5),
    az: a.z + az * (s - 0.5),
    bx: b.x + bx * (t - 0.5),
    bz: b.z + bz * (t - 0.5),
  };
}
export function resolveVehicleContacts(states: CityRaceState[]) {
  let contacts = 0;
  const correctionUsed = new Map(states.map((s) => [s, 0]));
  const tune = contactTuning;
  for (let i = 0; i < states.length; i++)
    for (let k = i + 1; k < states.length; k++) {
      const a = states[i],
        b = states[k];
      const ad = vehicleDimensions(a.vehicleId),
        bd = vehicleDimensions(b.vehicleId);
      if (
        a.finished ||
        b.finished ||
        Math.hypot(a.x - b.x, a.z - b.z) > ad.radius + bd.radius + ad.halfSpine + bd.halfSpine
      )
        continue;
      const ma = a.mass ?? tune.mass,
        mb = b.mass ?? tune.mass,
        ia = a.yawInertia ?? tune.yawInertia,
        ib = b.yawInertia ?? tune.yawInertia;
      const p = closest(a, b),
        dx = p.ax - p.bx,
        dz = p.az - p.bz,
        d = Math.hypot(dx, dz),
        penetration = ad.radius + bd.radius - d;
      if (penetration <= 0) continue;
      const fallback = Math.hypot(a.x - b.x, a.z - b.z),
        nx = d > 1e-6 ? dx / d : fallback > 1e-6 ? (a.x - b.x) / fallback : Math.cos(a.heading),
        nz = d > 1e-6 ? dz / d : fallback > 1e-6 ? (a.z - b.z) / fallback : -Math.sin(a.heading);
      const arx = p.ax - a.x - nx * ad.radius,
        arz = p.az - a.z - nz * ad.radius,
        brx = p.bx - b.x + nx * bd.radius,
        brz = p.bz - b.z + nz * bd.radius;
      const la = arz * nx - arx * nz,
        lb = brz * nx - brx * nz;
      const vn =
        (a.vx + a.impactYaw * arz - b.vx - b.impactYaw * brz) * nx +
        (a.vz - a.impactYaw * arx - b.vz + b.impactYaw * brx) * nz;
      if (vn < -0.02) {
        const impulse = (-1.08 * vn) / (1 / ma + 1 / mb + (la * la) / ia + (lb * lb) / ib);
        a.vx += (nx * impulse) / ma;
        a.vz += (nz * impulse) / ma;
        b.vx -= (nx * impulse) / mb;
        b.vz -= (nz * impulse) / mb;
        a.impactYaw += (la * impulse) / ia;
        b.impactYaw -= (lb * impulse) / ib;
        const tx = -nz,
          tz = nx,
          lta = arz * tx - arx * tz,
          ltb = brz * tx - brx * tz,
          vt =
            (a.vx + a.impactYaw * arz - b.vx - b.impactYaw * brz) * tx +
            (a.vz - a.impactYaw * arx - b.vz + b.impactYaw * brx) * tz,
          friction = Math.max(
            -0.18 * impulse,
            Math.min(0.18 * impulse, -vt / (1 / ma + 1 / mb + (lta * lta) / ia + (ltb * ltb) / ib)),
          );
        a.vx += (tx * friction) / ma;
        a.vz += (tz * friction) / ma;
        b.vx -= (tx * friction) / mb;
        b.vz -= (tz * friction) / mb;
        a.impactYaw += (lta * friction) / ia;
        b.impactYaw -= (ltb * friction) / ib;
        for (const s of [a, b]) {
          s.impactYaw = Math.max(-1.1, Math.min(1.1, s.impactYaw));
          s.speed = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
          s.collision = true;
          s.collisionImpulse += impulse;
        }
        contacts++;
      }
      // Positional stabilization is bounded per substep and never enters a curb.
      const correction = Math.min(0.36, Math.max(0, penetration - 0.003) * 0.5);
      for (const [s, sign] of [
        [a, 1],
        [b, -1],
      ] as const) {
        const amount = Math.max(0, Math.min(correction, 0.36 - (correctionUsed.get(s) ?? 0)));
        const x = s.x + nx * amount * sign,
          z = s.z + nz * amount * sign;
        if (carClearance({ x, z }, s.heading, s.vehicleId) >= 0) {
          s.x = x;
          s.z = z;
          correctionUsed.set(s, (correctionUsed.get(s) ?? 0) + amount);
        }
      }
    }
  return contacts;
}
