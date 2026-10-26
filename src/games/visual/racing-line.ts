import * as THREE from 'three';
import { buildRacingLine, racingLineColor, assistAhead, type RacingLineMode } from '../racing-line';
import type { RouteId } from '../route-registry';
import type { RaceState } from '../racing-physics';
import { getTrack, isTrackId } from '../tracks/registry';
import { projectRoad } from '../tracks/geometry';
export function createRacingLine(scene: THREE.Scene) {
  const geometry = new THREE.BufferGeometry(),
    material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.name = 'Dynamic_racing_line';
  mesh.layers.set(2);
  scene.add(mesh);
  let id: string | undefined,
    data: ReturnType<typeof buildRacingLine>,
    colors: THREE.Float32BufferAttribute,
    nearest = 0;
  const selected: { index: number; first: number; count: number }[] = [];
  const palette = {
    green: [0.23, 0.63, 0.38],
    yellow: [0.82, 0.63, 0.17],
    red: [0.78, 0.22, 0.17],
  };
  const stats = { red: 0, yellow: 0, green: 0 };
  return {
    update(route: RouteId, state: RaceState, mode: RacingLineMode) {
      mesh.visible = mode !== 'off';
      stats.red = stats.yellow = stats.green = 0;
      if (mode === 'off') return stats;
      const key = route + ':' + (state.vehicleId ?? 'legacy');
      if (id !== key) {
        id = key;
        data = buildRacingLine(route, state.vehicleId);
        const road = isTrackId(route) ? getTrack(route).roadGeometry : null;
        selected.length = 0;
        const positions: number[] = [],
          rgba: number[] = [];
        for (let i = 1; i < data.samples.length - 1; i += 3) {
          const p = data.samples[i],
            first = positions.length / 3;
          // An authored chevron ribbon, generated once per route. All points stay inside
          // a 1.3m corridor around the smoothed, clearance-tested route centerline.
          for (const [l, f] of [
            [-0.65, -1.3],
            [0, 0],
            [0, -0.65],
            [-0.65, -1.3],
            [0, -0.65],
            [-0.65, -1.95],
            [0, 0],
            [0.65, -1.3],
            [0.65, -1.95],
            [0, 0],
            [0.65, -1.95],
            [0, -0.65],
          ]) {
            const x = p.x - p.tz * l + p.tx * f,
              z = p.z + p.tx * l + p.tz * f;
            positions.push(x, (road ? projectRoad(road, x, z).height : 0) + 0.054, z);
            rgba.push(0, 0, 0, 0);
          }
          selected.push({ index: i, first, count: 12 });
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        colors = new THREE.Float32BufferAttribute(rgba, 4);
        colors.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('color', colors);
        geometry.computeBoundingSphere();
        nearest = 0;
      }
      let best = Infinity;
      for (let i = 0; i < data.samples.length; i++) {
        const p = data.samples[i],
          d = (p.x - state.x) ** 2 + (p.z - state.z) ** 2;
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      const progress = data.samples[nearest].s;
      for (const segment of selected) {
        const p = data.samples[segment.index],
          ahead = assistAhead(p, progress, data.length, data.closed),
          visible = ahead >= 2 && ahead <= 145 && (mode === 'full' || p.targetSpeed < 38),
          key = racingLineColor(state.speed, p, Math.max(0, ahead)),
          color = palette[key];
        if (visible) stats[key]++;
        for (let j = segment.first; j < segment.first + segment.count; j++)
          colors.setXYZW(j, color[0], color[1], color[2], visible ? 0.56 : 0);
      }
      colors.needsUpdate = true;
      return stats;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
