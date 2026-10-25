import { expect, it } from 'vitest';
import {
  routeRegistry,
  selectRoute,
  compatibleRoute,
  isCityRoute,
} from '../src/games/route-registry';
import { carClearance } from '../src/games/city-driving';
import { initialNetworkRace, stepNetworkRace } from '../src/games/network-racing';
import { getCityRoute } from '../src/games/road-network';
import { routeDriver } from './helpers/city-driver';
it('publishes shared geometry, ordered gates, six valid distinct grid slots and exact versions', () => {
  for (const r of routeRegistry) {
    expect(r.geometry.length).toBeGreaterThan(50);
    expect(r.finish).toBe(r.gates.at(-1));
    expect(new Set(r.grid.map((p) => p.x + ',' + p.z)).size).toBe(6);
    expect(compatibleRoute(selectRoute(r.routeId))).toBe(true);
    expect(compatibleRoute({ ...selectRoute(r.routeId), routeVersion: 999 })).toBe(false);
    if (isCityRoute(r.routeId)) {
      expect(r.geometry).toBe(getCityRoute(r.routeId).path);
      for (let i = 0; i < 6; i++) {
        const s = initialNetworkRace(i, selectRoute(r.routeId));
        expect(carClearance(s, s.heading), r.routeId + ' ' + i).toBeGreaterThan(0);
      }
    }
  }
});
it.each(['downtown-circuit', 'midnight-sprint', 'industrial-run'] as const)(
  'uses the same server/client physics and respects one-lap room config: %s',
  (id) => {
    const config = selectRoute(id, 1),
      a = initialNetworkRace(0, config),
      b = initialNetworkRace(0, config),
      route = getCityRoute(id);
    for (let i = 0; i < 10000 && a.lap === 1; i++) {
      const input = routeDriver(route, a);
      stepNetworkRace(a, input, 1 / 30, config);
      stepNetworkRace(b, input, 1 / 30, config);
    }
    expect(a).toEqual(b);
    expect(a.lap).toBe(2);
    expect(a.bestLap).toBeGreaterThan(8);
    const s = a as typeof a & { finished: boolean };
    expect(s.finished).toBe(true);
  },
);
it('normalizes sprint to one lap without silently accepting incompatible snapshot config', () => {
  expect(selectRoute('midnight-sprint', 3).laps).toBe(1);
  expect(compatibleRoute({ routeId: 'midnight-sprint', routeVersion: 1, laps: 3 })).toBe(false);
});
