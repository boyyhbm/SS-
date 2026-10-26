import { z } from 'zod';
import {
  cityRoutes,
  CITY_ROUTE_IDS,
  getCityRoute,
  type CityRouteId,
  type Point,
  type RouteGate,
} from './road-network';
import { initialRace, TRACK_RADIUS } from './racing-physics';
import { trackRegistry, TRACK_IDS } from './tracks/registry';
export const ROUTE_IDS = ['legacy-circuit', ...CITY_ROUTE_IDS, ...TRACK_IDS] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
export const routeIdSchema = z.enum(ROUTE_IDS);
export interface RouteSelection {
  routeId: RouteId;
  routeVersion: number;
  laps: number;
  carContacts?: boolean;
}
export interface RegisteredRoute {
  routeId: RouteId;
  routeVersion: number;
  name: string;
  nameRu: string;
  kind: 'circuit' | 'sprint';
  maxPlayers: number;
  laps: number;
  length: number;
  start: Point & { heading: number };
  grid: (Point & { heading: number })[];
  gates: RouteGate[];
  finish: RouteGate;
  geometry: Point[];
}
const grid = (start: Point & { heading: number }) =>
  Array.from({ length: 6 }, (_, slot) => {
    const lateral = (slot % 2 ? 1 : -1) * 2.1,
      back = Math.floor(slot / 2) * 5.3 + 2;
    return {
      x: start.x + Math.cos(start.heading) * lateral - Math.sin(start.heading) * back,
      z: start.z - Math.sin(start.heading) * lateral - Math.cos(start.heading) * back,
      heading: start.heading,
    };
  });
const legacyGates = [1, 2, 3, 4].map((i) => {
  const a = (i * Math.PI) / 2;
  return {
    x: TRACK_RADIUS * Math.cos(a),
    z: TRACK_RADIUS * Math.sin(a),
    tx: -Math.sin(a),
    tz: Math.cos(a),
    halfWidth: 11,
    distance: (i * Math.PI * TRACK_RADIUS) / 2,
  };
});
export const routeRegistry: RegisteredRoute[] = [
  {
    routeId: 'legacy-circuit',
    routeVersion: 1,
    name: 'Original Night Circuit',
    nameRu: 'Ночное кольцо — оригинал',
    kind: 'circuit',
    maxPlayers: 6,
    laps: 1,
    length: Math.PI * 2 * TRACK_RADIUS,
    start: initialRace(),
    grid: Array.from({ length: 6 }, (_, i) => ({
      ...initialRace(),
      x: 92 + (i % 2) * 5,
      z: -Math.floor(i / 2) * 5,
    })),
    gates: legacyGates,
    finish: legacyGates[3],
    geometry: Array.from({ length: 193 }, (_, i) => ({
      x: 95 * Math.cos((i / 192) * Math.PI * 2),
      z: 95 * Math.sin((i / 192) * Math.PI * 2),
    })),
  },
  ...cityRoutes.map((r) => ({
    routeId: r.id,
    routeVersion: 2,
    name: r.name,
    nameRu: r.nameRu,
    kind: r.kind,
    maxPlayers: 6,
    laps: r.laps,
    length: r.length,
    start: r.start,
    grid: grid(r.start),
    gates: r.gates,
    finish: r.gates.at(-1)!,
    geometry: r.path,
  })),
  ...trackRegistry.map((t) => ({
    routeId: t.trackId,
    routeVersion: t.trackVersion,
    name: t.trackName,
    nameRu: t.trackNameRu,
    kind: t.kind,
    maxPlayers: t.maxPlayers,
    laps: t.laps,
    length: t.length,
    start: t.start,
    grid: t.startGrid,
    gates: t.checkpoints,
    finish: t.finishLine,
    geometry: t.roadGeometry.sections,
  })),
];
export function getRoute(id: RouteId) {
  const route = routeRegistry.find((r) => r.routeId === id);
  if (!route) throw Error('routeMismatch');
  return route;
}
export const isCityRoute = (id: string): id is CityRouteId =>
  (CITY_ROUTE_IDS as readonly string[]).includes(id);
export function selectRoute(
  id: RouteId = 'legacy-circuit',
  laps?: number,
  carContacts = false,
): RouteSelection {
  const r = getRoute(id);
  return {
    routeId: id,
    routeVersion: r.routeVersion,
    carContacts: carContacts && isCityRoute(id),
    laps: r.kind === 'sprint' ? 1 : Math.max(1, Math.min(3, Math.floor(laps ?? r.laps))),
  };
}
export function compatibleRoute(config: RouteSelection) {
  const r = routeRegistry.find((r) => r.routeId === config.routeId);
  return (
    !!r &&
    r.routeVersion === config.routeVersion &&
    Number.isInteger(config.laps) &&
    (config.carContacts === undefined || typeof config.carContacts === 'boolean') &&
    (!config.carContacts || isCityRoute(config.routeId)) &&
    config.laps >= 1 &&
    config.laps <= 3 &&
    (r.kind !== 'sprint' || config.laps === 1)
  );
}
// The registry references the exact SP road-network definitions; no duplicate map.
export { getCityRoute };
