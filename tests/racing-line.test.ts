import { expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildRacingLine,
  racingLineColor,
  assistAhead,
  assistTuning,
} from '../src/games/racing-line';
import { createRacingLine } from '../src/games/visual/racing-line';
import { cityRoutes, roadClearance, distance } from '../src/games/road-network';
import { initialCityRace } from '../src/games/city-driving';
import { trackRegistry } from '../src/games/tracks/registry';
import { projectRoad } from '../src/games/tracks/geometry';
it.each(cityRoutes.map((r) => r.id))(
  'keeps the complete %s guide on actual road and obeys braking constraints',
  (id) => {
    const line = buildRacingLine(id);
    expect(line.samples.length).toBeGreaterThan(100);
    for (let i = 0; i < line.samples.length; i++) {
      const p = line.samples[i];
      expect(roadClearance(p)).toBeGreaterThan(2);
      expect(p.targetSpeed).toBeGreaterThan(1);
      expect(p.targetSpeed).toBeLessThanOrEqual(p.safeSpeed + 1e-6);
      if (i + 1 < line.samples.length) {
        const q = line.samples[i + 1];
        expect(p.targetSpeed ** 2).toBeLessThanOrEqual(
          q.targetSpeed ** 2 + 2 * assistTuning.braking * distance(p, q) + 1e-6,
        );
      }
    }
  },
);
it('changes warnings with speed, distance and braking instead of permanently coloring corners red', () => {
  const p = buildRacingLine('downtown-circuit').samples.reduce((a, b) =>
    a.targetSpeed < b.targetSpeed ? a : b,
  );
  expect(racingLineColor(3, p, 0)).toBe('green');
  expect(racingLineColor(p.targetSpeed * 0.95, p, 0)).toBe('yellow');
  expect(racingLineColor(p.targetSpeed * 1.3, p, 0)).toBe('red');
  expect(racingLineColor(p.targetSpeed * 1.3, p, 100)).toBe('green');
  expect(assistAhead({ ...p, s: 3 }, 99, 100, true)).toBe(4);
  expect(assistAhead({ ...p, s: 3 }, 99, 100, false)).toBe(-96);
});
it('reuses GPU buffers while updating colors and hides all guide geometry when disabled', () => {
  const scene = new THREE.Scene(),
    guide = createRacingLine(scene),
    state = initialCityRace('downtown-circuit');
  guide.update(state.routeId, state, 'full');
  const mesh = scene.getObjectByName('Dynamic_racing_line') as THREE.Mesh;
  const buffer = mesh.geometry.getAttribute('position');
  guide.update(state.routeId, { ...state, speed: 45 }, 'corners');
  expect(mesh.geometry.getAttribute('position')).toBe(buffer);
  guide.update(state.routeId, state, 'off');
  expect(mesh.visible).toBe(false);
  guide.dispose();
  expect(scene.children).toHaveLength(0);
});
it('places mountain and banked-circuit guidance on the real 3D surface and uses vehicle braking', () => {
  for (const track of trackRegistry) {
    const light = buildRacingLine(track.trackId, 'apex-r'),
      heavy = buildRacingLine(track.trackId, 'iron-v8');
    expect(light.samples.some((p, i) => p.targetSpeed > heavy.samples[i].targetSpeed + 0.1)).toBe(
      true,
    );
    for (const sample of light.samples) {
      const surface = projectRoad(track.roadGeometry, sample.x, sample.z);
      expect(sample.y).toBeCloseTo(surface.height, 5);
      expect(surface.clearance).toBeGreaterThan(2);
    }
    const scene = new THREE.Scene(),
      guide = createRacingLine(scene);
    guide.update(
      track.trackId,
      { ...initialCityRace('downtown-circuit'), vehicleId: 'apex-r' },
      'full',
    );
    const positions = (
      scene.getObjectByName('Dynamic_racing_line') as THREE.Mesh
    ).geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 12)
      expect(positions.getY(i)).toBeCloseTo(
        projectRoad(track.roadGeometry, positions.getX(i), positions.getZ(i)).height + 0.054,
        3,
      );
    guide.dispose();
  }
});
