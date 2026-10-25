import * as THREE from 'three';
import clipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import {
  roadNodes,
  roadEdges,
  edgeSamples,
  sampleRoad,
  edgeLength,
  junctionRadius,
  adjacent,
  type RoadEdge,
} from '../road-network';

function roadPolygons(extra: number): Polygon[] {
  const polys: Polygon[] = [];
  for (const e of roadEdges) {
    const p = edgeSamples[e.id],
      half = e.width / 2 + extra;
    const left = p.map((q) => [q.x - q.tz * half, q.z + q.tx * half] as [number, number]),
      right = p.map((q) => [q.x + q.tz * half, q.z - q.tx * half] as [number, number]).reverse();
    polys.push([[...left, ...right, left[0]]]);
  }
  for (const n of roadNodes) {
    const r = junctionRadius(n.id) + extra;
    const ring = Array.from(
      { length: 49 },
      (_, i) =>
        [
          n.x + Math.cos((i / 48) * Math.PI * 2) * r,
          n.z + Math.sin((i / 48) * Math.PI * 2) * r,
        ] as [number, number],
    );
    polys.push([ring]);
  }
  return polys;
}
let cached: { asphalt: MultiPolygon; sidewalk: MultiPolygon } | undefined;
export function roadSurfaces() {
  if (cached) return cached;
  const a = roadPolygons(0),
    b = roadPolygons(2.6);
  const asphalt = clipping.union(a[0], ...a.slice(1)),
    wide = clipping.union(b[0], ...b.slice(1));
  cached = { asphalt, sidewalk: clipping.difference(wide, asphalt) };
  return cached;
}
export function polygonSurface(polygons: MultiPolygon, y: number) {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (const polygon of polygons) {
    const rings = polygon.map((r) => r.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z))),
      outer = rings[0],
      holes = rings.slice(1),
      all = rings.flat(),
      offset = positions.length / 3;
    const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
    for (const p of all) {
      positions.push(p.x, y, p.y);
      uv.push(p.x / 6, p.y / 6);
    }
    for (const t of triangles) indices.push(offset + t[2], offset + t[1], offset + t[0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function roadRibbon(
  e: RoadEdge,
  from: number,
  to: number,
  offset: number,
  width: number,
  y = 0.028,
) {
  const vertices: number[] = [];
  const count = Math.max(1, Math.ceil((to - from) / 0.7));
  for (let i = 0; i < count; i++) {
    const a = sampleRoad(e, from + ((to - from) * i) / count, offset),
      b = sampleRoad(e, from + ((to - from) * (i + 1)) / count, offset);
    const p = [
      { x: a.x - (a.tz * width) / 2, z: a.z + (a.tx * width) / 2 },
      { x: a.x + (a.tz * width) / 2, z: a.z - (a.tx * width) / 2 },
      { x: b.x - (b.tz * width) / 2, z: b.z + (b.tx * width) / 2 },
      { x: b.x + (b.tz * width) / 2, z: b.z - (b.tx * width) / 2 },
    ];
    for (const j of [0, 2, 1, 1, 2, 3]) vertices.push(p[j].x, y, p[j].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  return g;
}
export function createRoadMarkings() {
  const white: THREE.BufferGeometry[] = [],
    yellow: THREE.BufferGeometry[] = [];
  for (const e of roadEdges) {
    const len = edgeLength(e),
      a = adjacent(e.from).length >= 3 ? junctionRadius(e.from) + 2 : 1,
      b = adjacent(e.to).length >= 3 ? junctionRadius(e.to) + 2 : 1,
      end = len - b;
    // All markings use the same arc-length parameterization and lateral normal as asphalt.
    for (const offset of [-e.width / 2 + 0.55, e.width / 2 - 0.55])
      white.push(roadRibbon(e, a, end, offset, 0.13));
    for (const offset of [-0.16, 0.16]) yellow.push(roadRibbon(e, a, end, offset, 0.12));
    if (e.lanes > 2)
      for (const offset of [-e.width / 4, e.width / 4])
        for (let s = Math.ceil(a / 12) * 12; s < end; s += 12)
          white.push(roadRibbon(e, s, Math.min(s + 5, end), offset, 0.13));
    for (const [id, reverse] of [
      [e.from, false],
      [e.to, true],
    ] as const) {
      if (adjacent(id).length < 3) continue;
      const clearance = junctionRadius(id) + 2;
      for (let lateral = -e.width / 2 + 0.9; lateral < e.width / 2 - 0.9; lateral += 1.2) {
        const from = reverse ? len - clearance - 3.2 : clearance,
          to = reverse ? len - clearance : clearance + 3.2;
        white.push(roadRibbon(e, from, to, lateral, 0.56));
      }
      const s = reverse ? len - clearance - 5.4 : clearance + 5.2;
      white.push(roadRibbon(e, s, s + 0.25, ((reverse ? 1 : -1) * e.width) / 4, e.width / 2 - 1));
    }
  }
  return { white, yellow };
}
export function curbGeometry(polygons: MultiPolygon) {
  const p: number[] = [];
  for (const poly of polygons)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i];
        for (const v of [
          [a[0], 0.02, a[1]],
          [b[0], 0.02, b[1]],
          [b[0], 0.17, b[1]],
          [a[0], 0.02, a[1]],
          [b[0], 0.17, b[1]],
          [a[0], 0.17, a[1]],
        ])
          p.push(...v);
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
