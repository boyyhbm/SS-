'use client';
import {
  cityRoutes,
  roadEdges,
  edgeSamples,
  getCityRoute,
  type CityRouteId,
  type Point,
} from '@/games/road-network';
const project = (p: Point) => ({ x: 8 + (p.x + 330) * 0.255, z: 8 + (p.z + 130) * 0.255 });
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
  routeId: CityRouteId;
  x?: number;
  z?: number;
  heading?: number;
  checkpoint?: number;
  overview?: boolean;
  language?: 'ru' | 'en';
}) {
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
