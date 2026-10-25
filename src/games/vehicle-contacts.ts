import type { CityRaceState } from './city-driving';
import { carClearance } from './city-driving';
import { contactTuning } from './contact-physics';
// Closest points of two finite capsule spines (Ericson segment/segment method).
function closest(a: CityRaceState, b: CityRaceState) {
  const ax = Math.sin(a.heading) * 2.5,
    az = Math.cos(a.heading) * 2.5,
    bx = Math.sin(b.heading) * 2.5,
    bz = Math.cos(b.heading) * 2.5,
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
      if (a.finished || b.finished || Math.hypot(a.x - b.x, a.z - b.z) > 5.2) continue;
      const p = closest(a, b),
        dx = p.ax - p.bx,
        dz = p.az - p.bz,
        d = Math.hypot(dx, dz),
        penetration = 2.1 - d;
      if (penetration <= 0) continue;
      const fallback = Math.hypot(a.x - b.x, a.z - b.z),
        nx = d > 1e-6 ? dx / d : fallback > 1e-6 ? (a.x - b.x) / fallback : Math.cos(a.heading),
        nz = d > 1e-6 ? dz / d : fallback > 1e-6 ? (a.z - b.z) / fallback : -Math.sin(a.heading);
      const arx = p.ax - a.x - nx * 1.05,
        arz = p.az - a.z - nz * 1.05,
        brx = p.bx - b.x + nx * 1.05,
        brz = p.bz - b.z + nz * 1.05;
      const la = arz * nx - arx * nz,
        lb = brz * nx - brx * nz;
      const vn =
        (a.vx + a.impactYaw * arz - b.vx - b.impactYaw * brz) * nx +
        (a.vz - a.impactYaw * arx - b.vz + b.impactYaw * brx) * nz;
      if (vn < -0.02) {
        const impulse = (-1.08 * vn) / (2 / tune.mass + (la * la + lb * lb) / tune.yawInertia);
        a.vx += (nx * impulse) / tune.mass;
        a.vz += (nz * impulse) / tune.mass;
        b.vx -= (nx * impulse) / tune.mass;
        b.vz -= (nz * impulse) / tune.mass;
        a.impactYaw += (la * impulse) / tune.yawInertia;
        b.impactYaw -= (lb * impulse) / tune.yawInertia;
        const tx = -nz,
          tz = nx,
          lta = arz * tx - arx * tz,
          ltb = brz * tx - brx * tz,
          vt =
            (a.vx + a.impactYaw * arz - b.vx - b.impactYaw * brz) * tx +
            (a.vz - a.impactYaw * arx - b.vz + b.impactYaw * brx) * tz,
          friction = Math.max(
            -0.18 * impulse,
            Math.min(
              0.18 * impulse,
              -vt / (2 / tune.mass + (lta * lta + ltb * ltb) / tune.yawInertia),
            ),
          );
        a.vx += (tx * friction) / tune.mass;
        a.vz += (tz * friction) / tune.mass;
        b.vx -= (tx * friction) / tune.mass;
        b.vz -= (tz * friction) / tune.mass;
        a.impactYaw += (lta * friction) / tune.yawInertia;
        b.impactYaw -= (ltb * friction) / tune.yawInertia;
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
        if (carClearance({ x, z }, s.heading) >= 0) {
          s.x = x;
          s.z = z;
          correctionUsed.set(s, (correctionUsed.get(s) ?? 0) + amount);
        }
      }
    }
  return contacts;
}
