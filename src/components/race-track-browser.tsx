'use client';
import Image from 'next/image';
import { useState } from 'react';
import { Modal } from './modal';
import { routeRegistry, type RouteId } from '@/games/route-registry';
import { getTrack, isTrackId } from '@/games/tracks/registry';
import { buildRacingLine } from '@/games/racing-line';
import { timeLabel } from '@/games/racing-physics';
import { GameRouteMap } from './game-route-map';
const tracks = routeRegistry
  .filter((r) => r.routeId !== 'legacy-circuit')
  .map((route) => {
    const curvature = Math.max(...buildRacingLine(route.routeId).samples.map((p) => p.curvature));
    return {
      ...route,
      radius: Math.round(1 / Math.max(0.0001, curvature)),
      image: isTrackId(route.routeId) ? route.routeId : 'downtown-circuit',
      environment: isTrackId(route.routeId) ? getTrack(route.routeId).environment : 'city',
    };
  });
export function RaceTrackBrowser({
  language,
  current,
  laps,
  records,
  onClose,
  onSelect,
}: {
  language: 'ru' | 'en';
  current: RouteId;
  laps: number;
  records: Partial<Record<RouteId, { best: number | null }>>;
  onClose: () => void;
  onSelect: (id: RouteId, laps: number) => void;
}) {
  const [selected, setSelected] = useState(current),
    [count, setCount] = useState(laps),
    route = tracks.find((r) => r.routeId === selected)!;
  return (
    <Modal
      title={language === 'ru' ? 'Выбор трассы' : 'Choose your track'}
      closeLabel={language === 'ru' ? 'Закрыть выбор трассы' : 'Close track selection'}
      onClose={onClose}
    >
      <div className="track-browser">
        <div className="track-browser-grid">
          {tracks.map((track) => (
            <button
              aria-pressed={selected === track.routeId}
              key={track.routeId}
              onClick={() => {
                setSelected(track.routeId);
                setCount(track.laps);
              }}
            >
              <figure>
                <Image
                  src={`/reports/racing-experience/images/${track.image}-high.png`}
                  alt={language === 'ru' ? track.nameRu : track.name}
                  width={640}
                  height={360}
                  unoptimized
                />
                <GameRouteMap routeId={track.routeId} language={language} overview />
              </figure>
              <div>
                <small>
                  {track.environment === 'city'
                    ? 'NEXUS CITY'
                    : track.environment === 'mountain'
                      ? 'MOUNTAIN PASS'
                      : track.environment === 'coast'
                        ? 'SCENIC HIGHWAY'
                        : 'RACING CIRCUIT'}
                </small>
                <h3>{language === 'ru' ? track.nameRu : track.name}</h3>
                <p>
                  {track.kind === 'sprint'
                    ? language === 'ru'
                      ? 'Спринт'
                      : 'Sprint'
                    : language === 'ru'
                      ? 'Кольцо'
                      : 'Circuit'}{' '}
                  · {(track.length / 1000).toFixed(2)} km ·{' '}
                  {language === 'ru' ? 'Повороты от' : 'Corners from'} ≈{track.radius} m
                </p>
                <span>
                  {records[track.routeId]?.best
                    ? `${language === 'ru' ? 'Ваш рекорд' : 'Your best'} ${timeLabel(records[track.routeId]!.best!)}`
                    : language === 'ru'
                      ? 'Ваших заездов ещё нет'
                      : 'No personal record yet'}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="track-browser-footer">
          <span>{language === 'ru' ? route.nameRu : route.name}</span>
          {route.kind === 'circuit' && (
            <label>
              {language === 'ru' ? 'Круги' : 'Laps'}{' '}
              <select
                value={count}
                aria-label={language === 'ru' ? 'Количество кругов' : 'Number of laps'}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[1, 2, 3].map((n) => (
                  <option value={n} key={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button primary"
            onClick={() => onSelect(selected, route.kind === 'sprint' ? 1 : count)}
          >
            {language === 'ru' ? 'Выбрать трассу' : 'Select Track'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
