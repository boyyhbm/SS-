// Deterministic planar rigid-body impulses, layered on the existing arcade drive.
// This is the only contact solver; no second engine owns vehicle transforms.
export const contactTuning = {
  mass: 1350,
  yawInertia: 2400,
  restitution: 0.12,
  friction: 0.26,
  maxImpactYaw: 1.1,
};
export type ContactBody = {
  vx: number;
  vz: number;
  heading: number;
  impactYaw: number;
  mass?: number;
  yawInertia?: number;
};
export function applyContactImpulse(
  body: ContactBody,
  nx: number,
  nz: number,
  rx: number,
  rz: number,
) {
  const t = {
      ...contactTuning,
      mass: body.mass ?? contactTuning.mass,
      yawInertia: body.yawInertia ?? contactTuning.yawInertia,
    },
    omega = body.impactYaw,
    vn = (body.vx + omega * rz) * nx + (body.vz - omega * rx) * nz;
  if (vn >= -0.02) return 0;
  const lever = rz * nx - rx * nz,
    j = (-(1 + t.restitution) * vn) / (1 / t.mass + (lever * lever) / t.yawInertia);
  body.vx += (nx * j) / t.mass;
  body.vz += (nz * j) / t.mass;
  body.impactYaw += (lever * j) / t.yawInertia;
  const tx = -nz,
    tz = nx,
    tangentLever = rz * tx - rx * tz,
    vt = (body.vx + body.impactYaw * rz) * tx + (body.vz - body.impactYaw * rx) * tz;
  const jt = Math.max(
    -t.friction * j,
    Math.min(t.friction * j, -vt / (1 / t.mass + (tangentLever * tangentLever) / t.yawInertia)),
  );
  body.vx += (tx * jt) / t.mass;
  body.vz += (tz * jt) / t.mass;
  body.impactYaw = Math.max(
    -t.maxImpactYaw,
    Math.min(t.maxImpactYaw, body.impactYaw + (tangentLever * jt) / t.yawInertia),
  );
  return j;
}
export function sweepBody(
  x: number,
  z: number,
  heading: number,
  toX: number,
  toZ: number,
  toHeading: number,
  clearance: (x: number, z: number, heading: number) => number,
) {
  const motion = Math.hypot(toX - x, toZ - z) + 1.65 * Math.abs(toHeading - heading);
  if (motion < 1e-8) return 1;
  // Bounded geometric CCD: each capsule endpoint moves at most 15cm per
  // sample, well below the expanded collider thickness (2.1m tyre capsule).
  // This also permits tangential sliding at a resting contact; conservative
  // advancement by near-zero SDF clearance would otherwise stall there.
  const steps = Math.max(1, Math.ceil(motion / 0.15));
  let safe = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (clearance(x + (toX - x) * t, z + (toZ - z) * t, heading + (toHeading - heading) * t) < 0) {
      let lo = safe,
        hi = t;
      for (let k = 0; k < 12; k++) {
        const m = (lo + hi) / 2;
        if (
          clearance(x + (toX - x) * m, z + (toZ - z) * m, heading + (toHeading - heading) * m) >=
          0.003
        )
          lo = m;
        else hi = m;
      }
      return lo;
    }
    safe = t;
  }
  return 1;
}
