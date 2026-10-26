import { expect, it } from 'vitest';
import { trackRegistry } from '../src/games/tracks/registry';
import { projectRoad, roadSectionPoint, sampleRoadDistance } from '../src/games/tracks/geometry';
import { initialTrackRace, stepTrackRace } from '../src/games/tracks/physics';
import { routeDriver } from './helpers/city-driver';
import { VEHICLE_IDS } from '../src/games/vehicles/config';
it('uses the same designed 3D geometry for road, contacts, map and line', () => {
  for (const t of trackRegistry) {
    expect(t.roadGeometry).toBe(t.roadColliders);
    expect(t.minimapData).toBe(t.roadGeometry.sections);
    expect(t.racingLineData).toBe(t.roadGeometry.sections);
    expect(t.length).toBeGreaterThan(700);
    expect(t.roadGeometry.sections.length).toBeGreaterThan(300);
    for (let i = t.kind === 'circuit' ? 0 : 13; i < t.roadGeometry.sections.length - 1; i += 13) {
      const p = t.roadGeometry.sections[i];
      expect([p.x, p.y, p.z, p.width, p.bank].every(Number.isFinite)).toBe(true);
      const inner = roadSectionPoint(p, p.width * 0.43),
        outer = roadSectionPoint(p, p.width * 0.58);
      expect(projectRoad(t.roadColliders, inner.x, inner.z).clearance).toBeGreaterThan(0.2);
      expect(projectRoad(t.roadColliders, outer.x, outer.z).clearance).toBeLessThan(-0.2);
      expect(projectRoad(t.roadColliders, p.x, p.z).height).toBeCloseTo(p.y, 2);
    }
    for (let i = 0; i < t.startGrid.length; i++)
      expect(
        projectRoad(t.roadColliders, t.startGrid[i].x, t.startGrid[i].z).clearance,
      ).toBeGreaterThan(1.1);
  }
});
it('closes circuit seams and gives the mountain real ascent and descent', () => {
  const circuit = trackRegistry.find((t) => t.kind === 'circuit')!,
    a = roadSectionPoint(circuit.roadGeometry.sections[0], -7),
    b = roadSectionPoint(circuit.roadGeometry.sections.at(-1)!, -7);
  expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.001);
  const mountain = trackRegistry.find((t) => t.trackType === 'mountain-pass')!;
  const dy = mountain.roadGeometry.sections
    .slice(1)
    .map((p, i) => p.y - mountain.roadGeometry.sections[i].y);
  expect(Math.max(...dy)).toBeGreaterThan(0.02);
  expect(Math.min(...dy)).toBeLessThan(-0.02);
  const beyond = sampleRoadDistance(mountain.roadGeometry, mountain.length);
  expect(
    projectRoad(mountain.roadGeometry, beyond.x + beyond.tx * 10, beyond.z + beyond.tz * 10)
      .clearance,
  ).toBeLessThan(0);
});
it('finishes each new track with every vehicle using only normalized controls', () => {
  for (const track of trackRegistry)
    for (const vehicle of VEHICLE_IDS) {
      const s = initialTrackRace(track.trackId, vehicle);
      let result: number | null = null;
      const route = { kind: track.kind, path: track.roadGeometry.sections };
      for (let i = 0; i < 18000 && result === null; i++)
        result = stepTrackRace(s, routeDriver(route, s), 1 / 30);
      expect(
        result,
        track.trackId +
          ' ' +
          vehicle +
          ' checkpoint ' +
          s.nextCheckpoint +
          ' ' +
          JSON.stringify({ x: s.x, z: s.z, speed: s.speed }),
      ).not.toBeNull();
      expect(s.y).toBeCloseTo(projectRoad(track.roadGeometry, s.x, s.z).height, 6);
    }
}, 30000);
