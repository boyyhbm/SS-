import { closestOnPolyline, distance, type CityRoute } from '../../src/games/road-network';
import { steeringAngle } from '../../src/games/city-driving';
import type { RaceState, RaceInput } from '../../src/games/racing-physics';
// QA input controller only. It never writes positions, checkpoints or results.
export function routeDriver(route: CityRoute, state: RaceState): RaceInput {
  const nearest = closestOnPolyline(state, route.path);
  let i = nearest.index,
    remaining = 8 + Math.abs(state.speed) * 0.4,
    target = route.path[i];
  while (remaining > 0 && i < route.path.length - 1) {
    const a = route.path[i],
      b = route.path[++i],
      len = distance(a, b);
    if (remaining < len) {
      target = {
        x: a.x + ((b.x - a.x) * remaining) / len,
        z: a.z + ((b.z - a.z) * remaining) / len,
      };
      break;
    }
    remaining -= len;
    target = b;
  }
  if (route.kind === 'circuit' && i === route.path.length - 1) {
    let j = 1;
    while (remaining > 0 && j < route.path.length) {
      const a = route.path[j - 1],
        b = route.path[j++],
        len = distance(a, b);
      if (remaining < len) {
        target = {
          x: a.x + ((b.x - a.x) * remaining) / len,
          z: a.z + ((b.z - a.z) * remaining) / len,
        };
        break;
      }
      remaining -= len;
      target = b;
    }
  }
  const desired = Math.atan2(target.x - state.x, target.z - state.z),
    error = Math.atan2(Math.sin(desired - state.heading), Math.cos(desired - state.heading));
  const look = Math.max(4, distance(state, target)),
    steer = Math.max(
      -1,
      Math.min(1, -Math.atan2(2 * 2.8 * Math.sin(error), look) / steeringAngle(state.speed)),
    );
  const speed = Math.abs(error) > 0.55 ? 10 : Math.abs(error) > 0.22 ? 17 : 27;
  return {
    throttle: Math.max(0, Math.min(1, 0.5 + (speed - state.speed) * 0.18)),
    brake: state.speed > speed + 2 ? Math.min(1, (state.speed - speed) * 0.12) : 0,
    steer,
    nitro: false,
  };
}
