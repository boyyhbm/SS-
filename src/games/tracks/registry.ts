import {
  compileRoad,
  sampleRoadDistance,
  roadSectionPoint,
  type TrackKnot,
  type TrackGeometry,
} from './geometry';
import type { AudioEnvironment } from '../audio/config';
export const TRACK_IDS = ['velocity-circuit', 'eagle-ridge', 'coastline-run'] as const;
export type TrackId = (typeof TRACK_IDS)[number];
export interface RaceTrack {
  trackId: TrackId;
  trackVersion: number;
  trackType: 'circuit' | 'mountain-pass' | 'coastal-highway';
  trackName: string;
  trackNameRu: string;
  environment: AudioEnvironment;
  kind: 'circuit' | 'sprint';
  splineData: readonly TrackKnot[];
  roadGeometry: TrackGeometry;
  roadColliders: TrackGeometry;
  checkpoints: {
    x: number;
    y: number;
    z: number;
    tx: number;
    tz: number;
    halfWidth: number;
    distance: number;
  }[];
  startGrid: { x: number; y: number; z: number; heading: number }[];
  start: { x: number; y: number; z: number; heading: number };
  finishLine: RaceTrack['checkpoints'][number];
  minimapData: TrackGeometry['sections'];
  racingLineData: TrackGeometry['sections'];
  supportedRaceModes: readonly string[];
  maxPlayers: number;
  laps: number;
  length: number;
  surface: string;
  durationLimitSeconds: number;
}
function track(
  id: TrackId,
  name: string,
  nameRu: string,
  type: RaceTrack['trackType'],
  environment: AudioEnvironment,
  kind: RaceTrack['kind'],
  knots: TrackKnot[],
  width: number,
  grip: number,
): RaceTrack {
  const road = compileRoad(knots, kind === 'circuit', width, grip),
    startAt = 18,
    finishAt = kind === 'sprint' ? road.length - 14 : startAt;
  const startPoint = sampleRoadDistance(road, startAt),
    count = Math.max(12, Math.ceil(road.length / 90));
  const checkpoints = Array.from({ length: count }, (_, i) => {
    const distance =
        kind === 'circuit'
          ? startAt + ((i + 1) * road.length) / count
          : startAt + ((i + 1) * (finishAt - startAt)) / count,
      p = sampleRoadDistance(road, distance);
    return { x: p.x, y: p.y, z: p.z, tx: p.tx, tz: p.tz, halfWidth: p.width / 2 - 0.7, distance };
  });
  const startGrid = Array.from({ length: 6 }, (_, i) => {
    const p = sampleRoadDistance(road, startAt - 2 - Math.floor(i / 2) * 5.3),
      point = roadSectionPoint(p, (i % 2 ? 1 : -1) * 2.1);
    return { ...point, heading: Math.atan2(p.tx, p.tz) };
  });
  return {
    trackId: id,
    trackVersion: 1,
    trackType: type,
    trackName: name,
    trackNameRu: nameRu,
    environment,
    kind,
    splineData: knots,
    roadGeometry: road,
    roadColliders: road,
    checkpoints,
    startGrid,
    start: {
      x: startPoint.x,
      y: startPoint.y,
      z: startPoint.z,
      heading: Math.atan2(startPoint.tx, startPoint.tz),
    },
    finishLine: checkpoints.at(-1)!,
    minimapData: road.sections,
    racingLineData: road.sections,
    supportedRaceModes:
      kind === 'circuit'
        ? ['practice', 'timeTrial', 'onlineCircuit']
        : ['practice', 'timeTrial', 'onlineSprint'],
    maxPlayers: 6,
    laps: kind === 'circuit' ? 3 : 1,
    length: road.length,
    surface: environment === 'mountain' ? 'cool asphalt' : 'dry asphalt',
    durationLimitSeconds: Math.ceil(road.length / 6 + 90),
  };
}
const k = (x: number, y: number, z: number, width = 12, bank = 0): TrackKnot => ({
  x,
  y,
  z,
  width,
  bank,
});
export const trackRegistry: RaceTrack[] = [
  track(
    'velocity-circuit',
    'Velocity Circuit',
    'Автодром Velocity',
    'circuit',
    'circuit',
    'circuit',
    [
      k(-220, 0, -180, 16),
      k(0, 0, -180, 16),
      k(200, 1, -180, 16),
      k(300, 2, -135, 15, 0.045),
      k(325, 3, -35, 15, 0.06),
      k(280, 4, 45, 14, 0.035),
      k(180, 3, 90, 13),
      k(120, 2, 50, 13),
      k(160, 1, -20, 12),
      k(100, 0, -50, 12),
      k(20, 0, 10, 13),
      k(-20, 0, 90, 14),
      k(-120, 1, 140, 15),
      k(-250, 0, 120, 15),
      k(-300, 0, 40, 14),
      k(-270, 0, -40, 14),
    ],
    14,
    1.04,
  ),
  track(
    'eagle-ridge',
    'Eagle Ridge',
    'Перевал Eagle Ridge',
    'mountain-pass',
    'mountain',
    'sprint',
    [
      k(-240, 15, -290, 13),
      k(-100, 20, -280, 13),
      k(70, 28, -250, 12),
      k(155, 35, -200, 12),
      k(130, 43, -150, 11),
      k(30, 52, -140, 11),
      k(-100, 62, -130, 11),
      k(-165, 70, -85, 11),
      k(-130, 78, -35, 11),
      k(-20, 88, -20, 12),
      k(100, 98, 0, 11),
      k(165, 107, 55, 11),
      k(125, 117, 105, 11),
      k(20, 125, 115, 12),
      k(-100, 132, 125, 11),
      k(-150, 138, 175, 11),
      k(-110, 143, 225, 12),
      k(10, 126, 250, 13),
      k(150, 110, 270, 14),
    ],
    12,
    0.94,
  ),
  track(
    'coastline-run',
    'Coastline Run',
    'Шоссе Coastline',
    'coastal-highway',
    'coast',
    'sprint',
    [
      k(-550, 23, -70, 15),
      k(-350, 27, -65, 15),
      k(-120, 38, -20, 15),
      k(80, 50, 70, 16, 0.025),
      k(300, 58, 90, 16),
      k(480, 47, 50, 15, -0.02),
      k(700, 29, -30, 16),
      k(940, 25, 20, 16, 0.025),
      k(1080, 35, 120, 15),
      k(1280, 45, 130, 15, -0.025),
      k(1480, 30, 30, 16),
      k(1680, 19, 5, 16),
    ],
    16,
    1,
  ),
];
export function isTrackId(id: string): id is TrackId {
  return (TRACK_IDS as readonly string[]).includes(id);
}
export function getTrack(id: TrackId) {
  const t = trackRegistry.find((t) => t.trackId === id);
  if (!t) throw Error('trackMismatch');
  return t;
}
