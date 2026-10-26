'use client';
import { cityRoutes, roadEdges, edgeSamples, getCityRoute, type Point } from '@/games/road-network';
import { getRoute, isCityRoute, routeRegistry, type RouteId } from '@/games/route-registry';
const trackMaps = new Map(
  routeRegistry
    .filter((r) => !isCityRoute(r.routeId))
    .map((r) => {
      const xs = r.geometry.map((p) => p.x),
        zs = r.geometry.map((p) => p.z),
        minX = Math.min(...xs),
        minZ = Math.min(...zs),
        maxX = Math.max(...xs),
        maxZ = Math.max(...zs);
      const scale = Math.min(144 / (maxX - minX || 1), 92 / (maxZ - minZ || 1));
      const project = (p: Point) => ({
        x: 82 + (p.x - (minX + maxX) / 2) * scale,
        z: 56 + (p.z - (minZ + maxZ) / 2) * scale,
      });
      const d = r.geometry
        .map((p, i) => {
          const q = project(p);
          return `${i ? 'L' : 'M'}${q.x.toFixed(2)},${q.z.toFixed(2)}`;
        })
        .join(' ');
      return [r.routeId, { project, d }] as const;
    }),
);
const cityPoints = Object.values(edgeSamples).flat(),
  cityBounds = {
    minX: Math.min(...cityPoints.map((p) => p.x)),
    maxX: Math.max(...cityPoints.map((p) => p.x)),
    minZ: Math.min(...cityPoints.map((p) => p.z)),
    maxZ: Math.max(...cityPoints.map((p) => p.z)),
  };
const cityScale = Math.min(
  144 / (cityBounds.maxX - cityBounds.minX),
  92 / (cityBounds.maxZ - cityBounds.minZ),
);
const project = (p: Point) => ({
  x: 82 + (p.x - (cityBounds.minX + cityBounds.maxX) / 2) * cityScale,
  z: 56 + (p.z - (cityBounds.minZ + cityBounds.maxZ) / 2) * cityScale,
});
const path = (points: Point[]) =>
  points
    .map((p, i) => {
      const q = project(p);
      return `${i ? 'L' : 'M'}${q.x.toFixed(2)},${q.z.toFixed(2)}`;
    })
    .join(' ');
const streets = roadEdges.map((e) => ({ id: e.id, d: path(edgeSamples[e.id]) }));
const routes = cityRoutes.map((r) => ({ id: r.id, d: path(r.path) }));
export function GameRouteMap({
  routeId,
  x,
  z,
  heading = 0,
  checkpoint = 1,
  overview = false,
  language = 'ru',
}: {
  routeId: RouteId;
  x?: number;
  z?: number;
  heading?: number;
  checkpoint?: number;
  overview?: boolean;
  language?: 'ru' | 'en';
}) {
  if (!isCityRoute(routeId)) {
    const route = getRoute(routeId),
      map = trackMaps.get(routeId)!,
      p = map.project({ x: x ?? route.start.x, z: z ?? route.start.z }),
      gate = route.gates[checkpoint - 1],
      g = gate ? map.project(gate) : null;
    return (
      <svg
        viewBox="0 0 164 112"
        role="img"
        data-testid="road-network-map"
        data-track={routeId}
        aria-label={language === 'ru' ? 'Схема трассы' : 'Track map'}
      >
        <path d={map.d} stroke="#152227" strokeWidth="8" fill="none" strokeLinejoin="round" />
        <path d={map.d} stroke="#d8ed9a" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
        {g && !overview && <circle cx={g.x} cy={g.z} r="2.8" fill="#eff9c9" />}
        <g transform={`translate(${p.x},${p.z}) rotate(${(-heading * 180) / Math.PI})`}>
          <path d="M0 4.5 L-3 -3 L0 -1.5 L3 -3Z" fill="#edffc9" stroke="#13262b" />
        </g>
      </svg>
    );
  }
  const route = getCityRoute(routeId),
    position = project({ x: x ?? route.start.x, z: z ?? route.start.z }),
    gate = route.gates[checkpoint - 1],
    g = gate ? project(gate) : null;
  return (
    <svg
      viewBox="0 0 164 112"
      role="img"
      aria-label={
        language === 'ru' ? 'Карта дорожной сети и маршрутов' : 'Road network and route map'
      }
      data-testid="road-network-map"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {streets.map((e) => (
          <path key={e.id} d={e.d} stroke="#718b8e" strokeWidth="2.8" strokeOpacity=".42" />
        ))}
        {routes
          .filter((r) => overview || r.id === routeId)
          .map((r, i) => (
            <path
              key={r.id}
              d={r.d}
              stroke={r.id === routeId ? '#d8ed9a' : ['#a6beed', '#d4aa89', '#7ac8c4'][i]}
              strokeWidth={r.id === routeId ? 2.5 : 1.4}
              strokeOpacity={r.id === routeId ? 1 : 0.5}
            />
          ))}
      </g>
      {g && !overview && (
        <circle cx={g.x} cy={g.z} r="2.8" fill="#e6ecbd" stroke="#142326" strokeWidth="1" />
      )}
      <g transform={`translate(${position.x},${position.z}) rotate(${(-heading * 180) / Math.PI})`}>
        <path d="M0 4.5 L-3 -3 L0 -1.5 L3 -3Z" fill="#edffc9" stroke="#13262b" strokeWidth="1" />
      </g>
    </svg>
  );
}
