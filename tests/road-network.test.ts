import { describe, it, expect } from 'vitest';
import {
  roadNodes,
  roadEdges,
  adjacent,
  edgeLength,
  sampleRoad,
  roadClearance,
  cityRoutes,
  distance,
} from '../src/games/road-network';
import {
  roadSurfaces,
  polygonSurface,
  createRoadMarkings,
  roadRibbon,
} from '../src/games/visual/roads';
describe('connected metric road network', () => {
  it('connects all three districts and has T/cross/fork junctions', () => {
    const visited = new Set([roadNodes[0].id]);
    let previous = 0;
    while (visited.size !== previous) {
      previous = visited.size;
      for (const e of roadEdges)
        if (visited.has(e.from) || visited.has(e.to)) {
          visited.add(e.from);
          visited.add(e.to);
        }
    }
    expect(visited.size).toBe(roadNodes.length);
    expect(roadNodes.some((n) => adjacent(n.id).length === 3)).toBe(true);
    expect(roadNodes.some((n) => adjacent(n.id).length === 4)).toBe(true);
    expect(new Set(roadEdges.map((e) => e.district)).size).toBe(3);
  });
  it('uses arc length for equal dashes and stable line widths on curves', () => {
    for (const e of roadEdges) {
      const len = edgeLength(e);
      for (let s = 4; s < len - 5; s += 5) {
        const a = sampleRoad(e, s),
          b = sampleRoad(e, s, 2);
        expect(distance(a, b)).toBeCloseTo(2, 5);
        expect(roadClearance(a)).toBeGreaterThan(4);
        expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1, 5);
        const mesh = roadRibbon(e, s, s + 3, 0, 0.13);
        const p = mesh.getAttribute('position');
        expect(Math.hypot(p.getX(0) - p.getX(2), p.getZ(0) - p.getZ(2))).toBeCloseTo(0.13, 3);
        mesh.dispose();
      }
    }
  });
  it('unions junction asphalt into one surface with upward normals, no coplanar overlapping road patches', () => {
    const s = roadSurfaces();
    expect(s.asphalt.length).toBe(1);
    const g = polygonSurface(s.asphalt, 0.02);
    expect(g.getAttribute('position').count).toBeGreaterThan(100);
    const normals = g.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0.99);
    g.dispose();
    const lines = createRoadMarkings();
    expect(lines.yellow.length).toBe(roadEdges.length * 2);
    [...lines.yellow, ...lines.white].forEach((g) => g.dispose());
  });
  it('defines distinct circuit/sprint/industrial routes independently from render geometry', () => {
    expect(cityRoutes).toHaveLength(3);
    expect(cityRoutes.map((r) => r.kind)).toContain('sprint');
    expect(new Set(cityRoutes.map((r) => r.length.toFixed(0))).size).toBe(3);
    for (const r of cityRoutes) {
      expect(roadClearance(r.start)).toBeGreaterThan(4);
      expect(r.gates.length).toBeGreaterThan(5);
      expect(r.gates.every((g) => roadClearance(g) > 3)).toBe(true);
    }
  });
});
