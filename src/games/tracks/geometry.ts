// Renderer-independent centripetal Catmull–Rom roads. Rendering, contacts,
// elevation, gates, minimaps and driving assists all consume these same sections.
export interface TrackKnot {
  x: number;
  y: number;
  z: number;
  width?: number;
  bank?: number;
  grip?: number;
}
export interface RoadSection {
  x: number;
  y: number;
  z: number;
  s: number;
  tx: number;
  ty: number;
  tz: number;
  nx: number;
  nz: number;
  width: number;
  bank: number;
  grip: number;
}
export interface TrackGeometry {
  sections: RoadSection[];
  length: number;
  closed: boolean;
  cells: Map<string, number[]>;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const len = (a: TrackKnot, b: TrackKnot) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function curve(p0: TrackKnot, p1: TrackKnot, p2: TrackKnot, p3: TrackKnot, t: number) {
  const d01 = Math.max(0.001, Math.sqrt(len(p0, p1))),
    d12 = Math.max(0.001, Math.sqrt(len(p1, p2))),
    d23 = Math.max(0.001, Math.sqrt(len(p2, p3)));
  const t0 = 0,
    t1 = d01,
    t2 = t1 + d12,
    t3 = t2 + d23,
    u = mix(t1, t2, t);
  const out = { x: 0, y: 0, z: 0 };
  for (const k of ['x', 'y', 'z'] as const) {
    const a1 = ((t1 - u) / (t1 - t0)) * p0[k] + ((u - t0) / (t1 - t0)) * p1[k],
      a2 = ((t2 - u) / (t2 - t1)) * p1[k] + ((u - t1) / (t2 - t1)) * p2[k],
      a3 = ((t3 - u) / (t3 - t2)) * p2[k] + ((u - t2) / (t3 - t2)) * p3[k];
    const b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2,
      b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3;
    out[k] = ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2;
  }
  return out;
}
export function compileRoad(
  knots: readonly TrackKnot[],
  closed: boolean,
  width = 12,
  grip = 1,
): TrackGeometry {
  if (knots.length < 4) throw Error('A designed road needs at least four control points');
  const raw: (TrackKnot & { width: number; bank: number; grip: number })[] = [];
  const at = (i: number): TrackKnot => {
    if (closed) return knots[(i + knots.length) % knots.length];
    if (i < 0) {
      const a = knots[0],
        b = knots[1];
      return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
    }
    if (i >= knots.length) {
      const a = knots.at(-1)!,
        b = knots.at(-2)!;
      return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
    }
    return knots[i];
  };
  for (let i = 0; i < (closed ? knots.length : knots.length - 1); i++) {
    const a = at(i),
      b = at(i + 1),
      steps = Math.max(12, Math.ceil(len(a, b)));
    for (let j = 0; j < steps; j++) {
      const t = j / steps,
        e = t * t * (3 - 2 * t);
      raw.push({
        ...curve(at(i - 1), a, b, at(i + 2), t),
        width: mix(a.width ?? width, b.width ?? width, e),
        bank: mix(a.bank ?? 0, b.bank ?? 0, e),
        grip: mix(a.grip ?? grip, b.grip ?? grip, e),
      });
    }
  }
  const last = closed ? raw[0] : knots.at(-1)!;
  raw.push({ ...last, width: last.width ?? width, bank: last.bank ?? 0, grip: last.grip ?? grip });
  let distance = 0,
    next = 0;
  const points: (TrackKnot & { s: number; width: number; bank: number; grip: number })[] = [];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1],
      b = raw[i],
      d = len(a, b);
    while (next <= distance + d) {
      const t = (next - distance) / (d || 1);
      points.push({
        x: mix(a.x, b.x, t),
        y: mix(a.y, b.y, t),
        z: mix(a.z, b.z, t),
        s: next,
        width: mix(a.width, b.width, t),
        bank: mix(a.bank, b.bank, t),
        grip: mix(a.grip, b.grip, t),
      });
      next += 1.5;
    }
    distance += d;
  }
  if (distance - points.at(-1)!.s > 1e-6) points.push({ ...raw.at(-1)!, s: distance });
  else points[points.length - 1] = { ...raw.at(-1)!, s: distance };
  const sections = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)],
      horizontal = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return {
      ...p,
      tx: (b.x - a.x) / horizontal,
      ty: (b.y - a.y) / horizontal,
      tz: (b.z - a.z) / horizontal,
      nx: (b.z - a.z) / horizontal,
      nz: -(b.x - a.x) / horizontal,
    };
  });
  // Match endpoint tangents for a seamless closed strip, including banking/UVs.
  if (closed) {
    const a = sections.at(-2)!,
      b = sections[1],
      d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    for (const p of [sections[0], sections.at(-1)!]) {
      p.tx = (b.x - a.x) / d;
      p.ty = (b.y - a.y) / d;
      p.tz = (b.z - a.z) / d;
      p.nx = p.tz;
      p.nz = -p.tx;
    }
  }
  const cells = new Map<string, number[]>();
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i],
      b = sections[i + 1],
      r = Math.max(a.width, b.width) / 2 + 5;
    for (
      let x = Math.floor((Math.min(a.x, b.x) - r) / 32);
      x <= Math.floor((Math.max(a.x, b.x) + r) / 32);
      x++
    )
      for (
        let z = Math.floor((Math.min(a.z, b.z) - r) / 32);
        z <= Math.floor((Math.max(a.z, b.z) + r) / 32);
        z++
      ) {
        const key = x + ',' + z;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(i);
      }
  }
  return { sections, length: distance, closed, cells };
}
export function sampleRoadDistance(road: TrackGeometry, s: number): RoadSection {
  s = road.closed
    ? ((s % road.length) + road.length) % road.length
    : Math.max(0, Math.min(road.length, s));
  let lo = 0,
    hi = road.sections.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (road.sections[m].s <= s) lo = m;
    else hi = m;
  }
  const a = road.sections[lo],
    b = road.sections[hi],
    t = (s - a.s) / (b.s - a.s || 1),
    out = { ...a };
  for (const k of [
    'x',
    'y',
    'z',
    's',
    'tx',
    'ty',
    'tz',
    'nx',
    'nz',
    'width',
    'bank',
    'grip',
  ] as const)
    out[k] = mix(a[k], b[k], t);
  return out;
}
export function roadSectionPoint(p: RoadSection, lateral: number, lift = 0) {
  const horizontal = lateral * Math.cos(p.bank);
  return {
    x: p.x + p.nx * horizontal,
    y: p.y + lateral * Math.sin(p.bank) + lift,
    z: p.z + p.nz * horizontal,
  };
}
export function projectRoad(road: TrackGeometry, x: number, z: number) {
  const local = road.cells.get(Math.floor(x / 32) + ',' + Math.floor(z / 32));
  const candidates = local ?? road.sections.slice(0, -1).map((_, i) => i);
  let index = 0,
    t = 0,
    best = Infinity;
  for (const i of candidates) {
    const a = road.sections[i],
      b = road.sections[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z,
      u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))),
      d = (x - a.x - dx * u) ** 2 + (z - a.z - dz * u) ** 2;
    if (d < best) {
      best = d;
      index = i;
      t = u;
    }
  }
  const a = road.sections[index],
    b = road.sections[index + 1],
    s = mix(a.s, b.s, t),
    p = sampleRoadDistance(road, s),
    dx = x - p.x,
    dz = z - p.z,
    lateral = dx * p.nx + dz * p.nz;
  let clearance = (p.width / 2) * Math.cos(p.bank) - Math.abs(lateral);
  if (!road.closed && index === 0 && t === 0)
    clearance = Math.min(clearance, dx * p.tx + dz * p.tz);
  if (!road.closed && index === road.sections.length - 2 && t === 1)
    clearance = Math.min(clearance, -dx * p.tx - dz * p.tz);
  return {
    ...p,
    lateral,
    clearance,
    height: p.y + lateral * Math.tan(p.bank),
    gradientX: p.ty * p.tx + Math.tan(p.bank) * p.nx,
    gradientZ: p.ty * p.tz + Math.tan(p.bank) * p.nz,
  };
}
