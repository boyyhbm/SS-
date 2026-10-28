import type { FoldNodeState } from './contracts';
export type V3 = { x: number; y: number; z: number };
export interface ArenaSolid {
  id: string;
  p: V3;
  size: V3;
  yaw?: number;
  pitch?: number;
  material: 'ivory' | 'dark' | 'cyan' | 'coral';
}
const solid = (
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: ArenaSolid['material'] = 'ivory',
  pitch = 0,
): ArenaSolid => ({ id, p: { x, y, z }, size: { x: w, y: h, z: d }, material, pitch });
export const foundrySolids: ArenaSolid[] = [
  solid('floor', 0, -0.3, 0, 46, 0.6, 36, 'dark'),
  solid('west-shell', -22, 2, 0, 1, 4, 36),
  solid('east-shell', 22, 2, 0, 1, 4, 36),
  solid('north-shell', 0, 2, -17.5, 45, 4, 1),
  solid('south-shell', 0, 2, 17.5, 45, 4, 1),
  solid('spawn-shield-a', 0, 1.7, 8, 5, 3.4, 1.1),
  solid('spawn-shield-b', 0, 1.7, -8, 5, 3.4, 1.1),
  solid('reactor-a', -6, 1.5, -7, 3.6, 3, 3.5),
  solid('reactor-b', 6, 1.5, 7, 3.6, 3, 3.5),
  solid('flank-a', -16, 0.75, 6, 3.5, 1.5, 2),
  solid('flank-b', 16, 0.75, -6, 3.5, 1.5, 2),
  solid('low-a', 6, 0.55, -11, 3, 1.1, 1.5),
  solid('low-b', -6, 0.55, 11, 3, 1.1, 1.5),
  solid('deck-west', -10, 2, 0, 6, 0.45, 7),
  solid('deck-east', 10, 2, 0, 6, 0.45, 7),
  solid('ramp-west', -10, 0.96, 6.8, 5, 0.35, 7, 'ivory', 0.32),
  solid('ramp-east', 10, 0.96, -6.8, 5, 0.35, 7, 'ivory', -0.32),
  solid('core-plinth', 0, 0.18, 0, 3.2, 0.36, 3.2, 'dark'),
  // Balanced, visible wing roofs. Their lower face is above the maximum
  // reachable player height, but server rays still hit the real ceiling.
  solid('roof-industrial', -17.25, 6.8, 0, 8.5, 0.4, 34, 'dark'),
  solid('roof-research', 17.25, 6.8, 0, 8.5, 0.4, 34, 'dark'),
];
export interface FoldDefinition {
  id: string;
  name: string;
  node: V3;
  size: V3;
  a: V3;
  b: V3;
  yawA: number;
  yawB: number;
}
export const foldDefinitions: FoldDefinition[] = [
  {
    id: 'shutter',
    name: 'SHIFT',
    node: { x: -6, y: 1.1, z: 3.7 },
    size: { x: 3.6, y: 2.8, z: 0.65 },
    a: { x: -5, y: 1.4, z: 0 },
    b: { x: -16, y: 1.4, z: 0 },
    yawA: 0,
    yawB: 0,
  },
  {
    id: 'pivot',
    name: 'TURN',
    node: { x: 6, y: 1.1, z: -3.7 },
    size: { x: 4.6, y: 2.8, z: 0.65 },
    a: { x: 6, y: 1.4, z: 0 },
    b: { x: 6, y: 1.4, z: 0 },
    yawA: 0,
    yawB: Math.PI / 2,
  },
  {
    id: 'bridge',
    name: 'LINK',
    node: { x: 0, y: 1.1, z: 4.2 },
    size: { x: 14, y: 0.35, z: 2.5 },
    a: { x: 0, y: -0.5, z: 0 },
    b: { x: 0, y: 2, z: 0 },
    yawA: 0,
    yawB: 0,
  },
];
export function foldTransform(def: FoldDefinition, node: FoldNodeState) {
  const t =
    node.phase === 'moving' ? (node.state === 0 ? node.progress : 1 - node.progress) : node.state;
  const u = t * t * (3 - 2 * t);
  return {
    x: def.a.x + (def.b.x - def.a.x) * u,
    y: def.a.y + (def.b.y - def.a.y) * u,
    z: def.a.z + (def.b.z - def.a.z) * u,
    yaw: def.yawA + (def.yawB - def.yawA) * u,
  };
}
// A deliberately conservative swept footprint, also shown as a warning on the floor.
export function inFoldSweep(def: FoldDefinition, p: V3, margin = 0.5) {
  const radius = Math.hypot(def.size.x, def.size.z) / 2;
  const rx = def.yawA !== def.yawB ? radius : def.size.x / 2;
  const rz = def.yawA !== def.yawB ? radius : def.size.z / 2;
  return (
    p.x > Math.min(def.a.x, def.b.x) - rx - margin &&
    p.x < Math.max(def.a.x, def.b.x) + rx + margin &&
    p.z > Math.min(def.a.z, def.b.z) - rz - margin &&
    p.z < Math.max(def.a.z, def.b.z) + rz + margin &&
    p.y - 0.85 < Math.max(def.a.y, def.b.y) + def.size.y / 2 + 0.1
  );
}
export const spawns = [
  { x: 0, y: 0.95, z: 13, yaw: 0 },
  { x: 0, y: 0.95, z: -13, yaw: Math.PI },
];
