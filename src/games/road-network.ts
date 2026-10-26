// Shared, renderer-independent road graph. Coordinates and arc lengths are metres.
export type Point = { x: number; z: number };
export type District = 'downtown' | 'industrial' | 'riverside';
export type RoadNode = Point & { id: string };
export type RoadEdge = {
  id: string;
  from: string;
  to: string;
  width: number;
  lanes: number;
  district: District;
  controls?: [Point, Point];
};
const node = (id: string, x: number, z: number): RoadNode => ({ id, x, z });
export const roadNodes = [
  node('d0', -160, -100),
  node('d1', -40, -100),
  node('d2', -160, 20),
  node('d3', -40, 20),
  node('d4', -160, 140),
  node('d5', -40, 140),
  node('i0', 100, -100),
  node('i1', 240, -100),
  node('i2', 100, 20),
  node('i3', 240, 20),
  node('i4', 100, 140),
  node('i5', 240, 140),
  node('r0', -280, -100),
  node('r1', -310, 20),
  node('r2', -280, 140),
  node('r3', -160, 230),
  node('m0', -40, 230),
];
const edge = (
  from: string,
  to: string,
  district: District = 'downtown',
  controls?: [Point, Point],
): RoadEdge => ({
  id: from + '-' + to,
  from,
  to,
  district,
  width: district === 'riverside' ? 11 : district === 'industrial' ? 16 : 18,
  lanes: district === 'downtown' ? 4 : 2,
  controls,
});
export const roadEdges = [
  edge('d0', 'd1'),
  edge('d0', 'd2'),
  edge('d1', 'd3'),
  edge('d2', 'd3'),
  edge('d2', 'd4'),
  edge('d3', 'd5'),
  edge('d4', 'd5'),
  edge('d1', 'i0', 'industrial'),
  edge('d3', 'i2', 'industrial'),
  edge('d5', 'i4', 'industrial'),
  edge('i0', 'i1', 'industrial'),
  edge('i0', 'i2', 'industrial'),
  edge('i1', 'i3', 'industrial'),
  edge('i2', 'i3', 'industrial'),
  edge('i2', 'i4', 'industrial'),
  edge('i4', 'i5', 'industrial'),
  edge('i3', 'i5', 'industrial', [
    { x: 280, z: 50 },
    { x: 280, z: 115 },
  ]),
  edge('r0', 'd0', 'riverside'),
  edge('r0', 'r1', 'riverside', [
    { x: -315, z: -60 },
    { x: -320, z: -20 },
  ]),
  edge('r1', 'd2', 'riverside', [
    { x: -255, z: 55 },
    { x: -220, z: 5 },
  ]),
  edge('r1', 'r2', 'riverside', [
    { x: -300, z: 65 },
    { x: -315, z: 95 },
  ]),
  edge('r2', 'd4', 'riverside'),
  edge('r2', 'r3', 'riverside', [
    { x: -250, z: 205 },
    { x: -220, z: 230 },
  ]),
  edge('r3', 'm0', 'riverside'),
  edge('d5', 'm0', 'downtown'),
  edge('m0', 'i4', 'industrial', [
    { x: 30, z: 230 },
    { x: 100, z: 210 },
  ]),
];
export const nodeById = Object.fromEntries(roadNodes.map((n) => [n.id, n]));
export const edgeById = Object.fromEntries(roadEdges.map((e) => [e.id, e]));
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
const unit = (p: Point): Point => {
  const d = Math.hypot(p.x, p.z) || 1;
  return { x: p.x / d, z: p.z / d };
};
export const adjacent = (id: string) => roadEdges.filter((e) => e.from === id || e.to === id);
export function junctionRadius(id: string) {
  return Math.max(...adjacent(id).map((e) => e.width / 2)) + 1.2;
}
export type RoadSample = Point & { s: number; tx: number; tz: number };
export const edgeSamples: Record<string, RoadSample[]> = Object.fromEntries(
  roadEdges.map((e) => {
    const a = nodeById[e.from],
      b = nodeById[e.to],
      points: RoadSample[] = [];
    const steps = Math.ceil(
      (distance(a, b) +
        (e.controls ? distance(a, e.controls[0]) + distance(b, e.controls[1]) : 0)) /
        1.5,
    );
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t;
      let p: Point, tangent: Point;
      if (e.controls) {
        const [c, d] = e.controls;
        p = {
          x: u * u * u * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t * t * t * b.x,
          z: u * u * u * a.z + 3 * u * u * t * c.z + 3 * u * t * t * d.z + t * t * t * b.z,
        };
        tangent = unit({
          x: 3 * u * u * (c.x - a.x) + 6 * u * t * (d.x - c.x) + 3 * t * t * (b.x - d.x),
          z: 3 * u * u * (c.z - a.z) + 6 * u * t * (d.z - c.z) + 3 * t * t * (b.z - d.z),
        });
      } else {
        p = lerpPoint(a, b, t);
        tangent = unit({ x: b.x - a.x, z: b.z - a.z });
      }
      points.push({
        ...p,
        s: i ? points[i - 1].s + distance(points[i - 1], p) : 0,
        tx: tangent.x,
        tz: tangent.z,
      });
    }
    return [e.id, points];
  }),
);
export function edgeLength(edge: RoadEdge) {
  return edgeSamples[edge.id].at(-1)!.s;
}
export function sampleRoad(edge: RoadEdge, s: number, offset = 0): RoadSample {
  const points = edgeSamples[edge.id];
  s = Math.max(0, Math.min(edgeLength(edge), s));
  let lo = 0,
    hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].s < s) lo = mid;
    else hi = mid;
  }
  const a = points[lo],
    b = points[hi],
    t = (s - a.s) / Math.max(0.0001, b.s - a.s),
    p = lerpPoint(a, b, t),
    v = unit({ x: a.tx + (b.tx - a.tx) * t, z: a.tz + (b.tz - a.tz) * t });
  return { ...p, x: p.x - v.z * offset, z: p.z + v.x * offset, s, tx: v.x, tz: v.z };
}
export function closestOnPolyline(p: Point, points: Point[]) {
  let best = { x: points[0].x, z: points[0].z, distance: Infinity, index: 0, t: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dz = b.z - a.z,
      t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
      ),
      q = { x: a.x + dx * t, z: a.z + dz * t },
      d = distance(p, q);
    if (d < best.distance) best = { ...q, distance: d, index: i - 1, t };
  }
  return best;
}
// The graph is immutable at runtime. Cache query geometry and junction radii once;
// reconciliation can replay many vehicle contacts for each received snapshot.
const clearanceEdges = roadEdges.map((edge) => {
  const points = edgeSamples[edge.id],
    first = points[0],
    last = points.at(-1)!;
  const queryPoints = edge.controls ? points : [first, last];
  return {
    halfWidth: edge.width / 2,
    minX: Math.min(first.x, last.x) - 80,
    maxX: Math.max(first.x, last.x) + 80,
    minZ: Math.min(first.z, last.z) - 80,
    maxZ: Math.max(first.z, last.z) + 80,
    segments: queryPoints.slice(1).map((b, i) => {
      const a = queryPoints[i],
        dx = b.x - a.x,
        dz = b.z - a.z;
      return {
        x: a.x,
        z: a.z,
        dx,
        dz,
        lengthSquared: dx * dx + dz * dz || 1,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minZ: Math.min(a.z, b.z),
        maxZ: Math.max(a.z, b.z),
      };
    }),
  };
});
const clearanceJunctions = roadNodes.map((n) => ({ ...n, radius: junctionRadius(n.id) }));
export function roadClearance(p: Point) {
  let clearance = -Infinity;
  for (const edge of clearanceEdges) {
    if (p.x < edge.minX || p.x > edge.maxX || p.z < edge.minZ || p.z > edge.maxZ) continue;
    let squared = Infinity;
    for (const s of edge.segments) {
      const bx = Math.max(s.minX - p.x, 0, p.x - s.maxX),
        bz = Math.max(s.minZ - p.z, 0, p.z - s.maxZ);
      if (bx * bx + bz * bz >= squared) continue;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - s.x) * s.dx + (p.z - s.z) * s.dz) / s.lengthSquared),
      );
      const ex = p.x - s.x - s.dx * t,
        ez = p.z - s.z - s.dz * t;
      squared = Math.min(squared, ex * ex + ez * ez);
    }
    clearance = Math.max(clearance, edge.halfWidth - Math.sqrt(squared));
  }
  for (const n of clearanceJunctions) clearance = Math.max(clearance, n.radius - distance(p, n));
  return clearance;
}

export const CITY_ROUTE_IDS = ['downtown-circuit', 'midnight-sprint', 'industrial-run'] as const;
export const cityParkedCars = [
  { x: -118, z: 27, heading: Math.PI / 2 },
  { x: -92, z: 27, heading: Math.PI / 2 },
  { x: 25, z: -107, heading: -Math.PI / 2 },
  { x: 165, z: 147, heading: Math.PI / 2 },
];
export type CityRouteId = (typeof CITY_ROUTE_IDS)[number];
export type RouteGate = Point & { tx: number; tz: number; halfWidth: number; distance: number };
export type CityRoute = {
  id: CityRouteId;
  name: string;
  nameRu: string;
  kind: 'circuit' | 'sprint';
  nodes: string[];
  laps: number;
  path: Point[];
  gates: RouteGate[];
  start: Point & { heading: number };
  length: number;
};
function makeRoute(
  id: CityRouteId,
  name: string,
  nameRu: string,
  nodes: string[],
  kind: 'circuit' | 'sprint',
): CityRoute {
  const path: Point[] = [],
    gates: RouteGate[] = [];
  let total = 0;
  const oriented = nodes.slice(1).map((to, i) => {
    const from = nodes[i],
      edge = roadEdges.find(
        (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
      );
    if (!edge) throw Error('Disconnected route ' + id);
    return { edge, reverse: edge.from !== from };
  });
  for (const { edge, reverse } of oriented) {
    const points = reverse ? [...edgeSamples[edge.id]].reverse() : edgeSamples[edge.id];
    for (const p of points) {
      if (path.length) total += distance(path.at(-1)!, p);
      path.push({ x: p.x, z: p.z });
    }
    const g = sampleRoad(edge, edgeLength(edge) * (reverse ? 0.35 : 0.65));
    gates.push({
      x: g.x,
      z: g.z,
      tx: g.tx * (reverse ? -1 : 1),
      tz: g.tz * (reverse ? -1 : 1),
      halfWidth: edge.width / 2 - 0.6,
      distance: total - edgeLength(edge) * 0.35,
    });
  }
  const first = oriented[0],
    length = edgeLength(first.edge),
    startSample = sampleRoad(first.edge, first.reverse ? length - 18 : 18),
    sign = first.reverse ? -1 : 1;
  const start = {
    x: startSample.x,
    z: startSample.z,
    heading: Math.atan2(startSample.tx * sign, startSample.tz * sign),
  };
  if (kind === 'circuit')
    gates.push({
      ...start,
      tx: startSample.tx * sign,
      tz: startSample.tz * sign,
      halfWidth: first.edge.width / 2 - 0.6,
      distance: total,
    });
  else {
    const last = oriented.at(-1)!,
      g = sampleRoad(last.edge, edgeLength(last.edge) * (last.reverse ? 0.1 : 0.9));
    gates.push({
      x: g.x,
      z: g.z,
      tx: g.tx * (last.reverse ? -1 : 1),
      tz: g.tz * (last.reverse ? -1 : 1),
      halfWidth: last.edge.width / 2 - 0.6,
      distance: total,
    });
  }
  return {
    id,
    name,
    nameRu,
    nodes,
    kind,
    laps: kind === 'circuit' ? 3 : 1,
    path,
    gates,
    start,
    length: total,
  };
}
export const cityRoutes: CityRoute[] = [
  makeRoute(
    'downtown-circuit',
    'Downtown Circuit',
    'Кольцо центра',
    ['d2', 'd0', 'd1', 'd3', 'd5', 'd4', 'd2'],
    'circuit',
  ),
  makeRoute(
    'midnight-sprint',
    'Midnight Sprint',
    'Полуночный спринт',
    ['r2', 'r1', 'r0', 'd0', 'd1', 'i0', 'i1', 'i3', 'i2'],
    'sprint',
  ),
  makeRoute(
    'industrial-run',
    'Industrial Run',
    'Промышленный заезд',
    ['d3', 'i2', 'i0', 'i1', 'i3', 'i5', 'i4', 'd5', 'd3'],
    'circuit',
  ),
];
export const getCityRoute = (id: CityRouteId) => cityRoutes.find((r) => r.id === id)!;
