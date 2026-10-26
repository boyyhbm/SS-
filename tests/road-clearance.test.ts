import { test, expect } from 'vitest';
import {
  roadClearance,
  roadEdges,
  edgeSamples,
  roadNodes,
  junctionRadius,
  distance,
  type Point,
} from '../src/games/road-network';
function referenceClearance(p: Point) {
  let clearance = -Infinity;
  for (const e of roadEdges) {
    const points = edgeSamples[e.id];
    let squared = Infinity;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dz = b.z - a.z;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
      );
      const ex = p.x - a.x - dx * t,
        ez = p.z - a.z - dz * t;
      squared = Math.min(squared, ex * ex + ez * ez);
    }
    clearance = Math.max(clearance, e.width / 2 - Math.sqrt(squared));
  }
  for (const n of roadNodes) clearance = Math.max(clearance, junctionRadius(n.id) - distance(p, n));
  return clearance;
}
test('cached road queries preserve clearance on the complete graph, curves and contact boundaries', () => {
  let seed = 0x53782;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const points: Point[] = [{ x: -278.4825069050246, z: -104.39826962841757 }];
  for (let i = 0; i < 10000; i++)
    points.push({ x: -380 + random() * 720, z: -180 + random() * 450 });
  for (const e of roadEdges)
    for (const p of edgeSamples[e.id])
      for (const offset of [
        -e.width / 2,
        -e.width / 2 + 0.001,
        0,
        e.width / 2 - 0.001,
        e.width / 2,
      ])
        points.push({ x: p.x - p.tz * offset, z: p.z + p.tx * offset });
  for (const n of roadNodes)
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12,
        r = junctionRadius(n.id);
      points.push({ x: n.x + Math.cos(a) * r, z: n.z + Math.sin(a) * r });
    }
  let maxError = 0;
  for (const p of points)
    maxError = Math.max(maxError, Math.abs(referenceClearance(p) - roadClearance(p)));
  expect(points.length).toBeGreaterThan(20000);
  expect(maxError).toBeLessThan(1e-9);
});
