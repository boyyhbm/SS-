'use client';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Gamepad2,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { dictionary, translate, type TextKey } from '@/lib/i18n';
import { useUI } from '@/lib/ui-store';
import { timeLabel, type RaceInput } from '@/games/racing-physics';
import type { RaceTelemetry } from '@/games/midnight-outlaws';
import { nexusInput } from '@/input/manager';
import { consoleReturn } from '@/input/focus';
import { GameControlsHint } from './input-system';
import { RaceHUD, GraphicsSettings } from './race-hud';
import { InputNavigation } from './input-navigation';
import { routeRegistry, routeIdSchema, type RouteId } from '@/games/route-registry';
import { GameRouteMap } from './game-route-map';
import { GameAudioSettings } from './game-audio-settings';
import { VehicleSelect } from './vehicle-select';
import { useGaragePreference } from '@/games/vehicles/preferences';
const Race = dynamic(() => import('@/games/midnight-outlaws').then((m) => m.MidnightOutlaws), {
  ssr: false,
});
const TrackBrowser = dynamic(() => import('./race-track-browser').then((m) => m.RaceTrackBrowser), {
  ssr: false,
});
const selectableRoutes = routeRegistry
  .filter((r) => r.routeId !== 'legacy-circuit')
  .map((r) => ({ ...r, id: r.routeId }));
export function GamePlayer({
  gameId,
  title,
  language,
  initialBestLap,
  initialHistory,
  initialRouteRecords = {},
}: {
  gameId: string;
  title: string;
  language: 'ru' | 'en';
  initialBestLap: number | null;
  initialHistory: { seconds: number; recordedAt: string }[];
  initialRouteRecords?: Partial<
    Record<RouteId, { best: number | null; history: { seconds: number; recordedAt: string }[] }>
  >;
}) {
  const [mode, setMode] = useState<'practice' | 'timeTrial'>('timeTrial');
  const garage = useGaragePreference();
  useEffect(() => {
    void useGaragePreference.getState().load();
  }, []);
  const search = useSearchParams();
  const [routeId, setRouteId] = useState<RouteId>(() => {
    const route = routeIdSchema.safeParse(search.get('route'));
    return route.success && route.data !== 'legacy-circuit' ? route.data : 'downtown-circuit';
  });
  const [selectedLaps, setSelectedLaps] = useState(3);
  const [trackBrowser, setTrackBrowser] = useState(false);
  const [routeRecords, setRouteRecords] = useState(initialRouteRecords);
  const history = routeRecords[routeId]?.history ?? [];
  const routeBest = routeRecords[routeId]?.best ?? null;
  const router = useRouter();
  const ui = useUI();
  const t = useCallback((key: TextKey) => dictionary[language][key], [language]);
  const [ready, setReady] = useState(false),
    [sessionId, setSessionId] = useState(''),
    [started, setStarted] = useState(false),
    [paused, setPaused] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [restartKey, setRestartKey] = useState(0),
    [busy, setBusy] = useState(false);
  const [telemetry, setTelemetry] = useState<RaceTelemetry>({
    speed: 0,
    nitro: 100,
    lap: 1,
    lapTime: 0,
    bestLap: routeBest,
    nextCheckpoint: 1,
    collision: false,
    x: 95,
    z: 1,
    heading: 0,
  });
  const input = useRef<RaceInput>({ throttle: 0, brake: 0, steer: 0, nitro: false });
  useEffect(() => () => nexusInput.clearVirtual(), []);
  useEffect(() => {
    if (paused) nexusInput.clearVirtual();
  }, [paused]);
  const session = useRef('');
  const root = useRef<HTMLDivElement>(null);
  const starting = useRef<Promise<string> | null>(null);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const ensureSession = useCallback(async () => {
    if (starting.current) return starting.current;
    starting.current = (async () => {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', gameId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      session.current = data.sessionId;
      setSessionId(data.sessionId);
      return data.sessionId as string;
    })();
    try {
      return await starting.current;
    } catch (e) {
      starting.current = null;
      throw e;
    }
  }, [gameId]);
  async function begin() {
    setBusy(true);
    try {
      await ensureSession();
      void nexusInput.haptic('start');
      setStarted(true);
      setPaused(false);
    } catch (e) {
      setError(translate(language, e instanceof Error ? e.message : 'gameError'));
    } finally {
      setBusy(false);
    }
  }
  const togglePause = useCallback(() => {
    if (started) setPaused((value) => !value);
  }, [started]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    void fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: paused ? 'pause' : 'resume', sessionId }),
    }).catch(() => setNotice(t('saveFailed')));
  }, [sessionId, paused, t]);
  useEffect(() => {
    if (!sessionId || paused) return;
    const timer = setInterval(() => {
      void fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat', sessionId }),
      })
        .then((res) => {
          if (!res.ok) setNotice(t('saveFailed'));
        })
        .catch(() => setNotice(t('saveFailed')));
    }, 15000);
    return () => clearInterval(timer);
  }, [sessionId, paused, t]);
  useEffect(() => {
    const end = () => {
      if (session.current) {
        navigator.sendBeacon(
          '/api/sessions',
          new Blob([JSON.stringify({ action: 'end', sessionId: session.current })], {
            type: 'application/json',
          }),
        );
        session.current = '';
      }
    };
    window.addEventListener('pagehide', end);
    return () => {
      window.removeEventListener('pagehide', end);
      end();
    };
  }, []);
  useEffect(() => {
    if (!started) return;
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat) {
        setRestartKey((x) => x + 1);
        setPaused(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [started]);
  const lap = useCallback(
    async (seconds: number) => {
      setNotice(t('lapCompleted'));
      if (mode === 'practice') return;
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'lap',
            sessionId: session.current,
            seconds,
            routeId,
            vehicleId: garage.value.vehicleId,
          }),
        });
        if (!res.ok) throw new Error();
        const result = await res.json();
        setRouteRecords((previous) => ({
          ...previous,
          [routeId]: {
            best: Math.min(previous[routeId]?.best ?? Infinity, seconds),
            history: [
              ...(previous[routeId]?.history ?? []),
              { seconds, recordedAt: new Date().toISOString() },
            ]
              .sort((a, b) => a.seconds - b.seconds)
              .slice(0, 10),
          },
        }));
        setNotice(t(result.recordUpdated ? 'recordSaved' : 'lapCompleted'));
      } catch {
        setNotice(t('saveFailed'));
      }
    },
    [t, mode, routeId, garage.value.vehicleId],
  );
  async function exit() {
    setPaused(true);
    setBusy(true);
    try {
      if (session.current) {
        await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'end', sessionId: session.current }),
        });
        session.current = '';
      }
      if (document.fullscreenElement) await document.exitFullscreen();
      router.push(consoleReturn().path);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  function touch(field: keyof RaceInput, value: number | boolean) {
    const action = field === 'throttle' ? 'accelerate' : field === 'nitro' ? 'boost' : field;
    return {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        nexusInput.setVirtual(action, Number(value));
      },
      onPointerUp: () => {
        nexusInput.setVirtual(action, 0);
      },
      onPointerCancel: () => {
        nexusInput.setVirtual(action, 0);
      },
    };
  }
  return (
    <div
      data-testid="race-player"
      data-x={telemetry.x}
      data-z={telemetry.z}
      data-heading={telemetry.heading}
      data-lap={telemetry.lap}
      data-route={routeId}
      className={`game-player ${telemetry.collision ? 'collision-flash' : ''}`}
      ref={root}
    >
      <InputNavigation suspended={!paused && !telemetry.finished} />
      <Race
        language={language}
        paused={paused || !started}
        onReady={() => setReady(true)}
        onLoading={() => setReady(false)}
        onError={() => setError(t('gameError'))}
        onLap={lap}
        onTelemetry={setTelemetry}
        inputRef={input}
        onPause={togglePause}
        restartKey={restartKey}
        initialBestLap={routeBest}
        routeId={routeId}
        freeDrive={mode === 'practice'}
        vehicleId={garage.value.vehicleId}
        paint={garage.value.paint}
        laps={selectedLaps}
      />
      <div className="player-topbar">
        <button className="player-brand" onClick={exit} aria-label={t('exitGame')}>
          N<span>/</span>
        </button>
        <div>
          <span>NEXUS ORIGINAL</span>
          <strong>{title}</strong>
        </div>
        <div className="player-topbar-actions">
          <button
            aria-label={t('fullscreen')}
            className="icon-button"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await root.current?.requestFullscreen();
              } catch {
                setNotice(t('gameError'));
              }
            }}
          >
            <Maximize2 size={18} />
          </button>
          <button
            aria-label={t('pause')}
            className="icon-button"
            onClick={togglePause}
            disabled={!started}
          >
            <Pause size={20} />
          </button>
          <button className="icon-button" aria-label={t('exitGame')} onClick={exit}>
            <X size={23} />
          </button>
        </div>
      </div>
      {started && (
        <>
          <RaceHUD telemetry={telemetry} language={language} mode={mode} laps={selectedLaps} />
          {telemetry.finished && mode !== 'practice' && !paused && (
            <div className="pause-overlay route-finish-overlay">
              <div className="route-finish-card">
                <strong>{language === 'ru' ? 'Маршрут завершён' : 'Route completed'}</strong>
                <button
                  autoFocus
                  data-game-back
                  className="button primary"
                  onClick={() => {
                    setStarted(false);
                    setPaused(true);
                    setRestartKey((x) => x + 1);
                  }}
                >
                  {language === 'ru' ? 'Выбрать маршрут' : 'Choose route'}
                </button>
              </div>
            </div>
          )}
          {!paused && (
            <div className="touch-controls">
              <div>
                <button aria-label={t('back')} {...touch('steer', -1)}>
                  <ArrowLeft size={24} />
                </button>
                <button aria-label={t('confirm')} {...touch('steer', 1)}>
                  <ArrowRight size={24} />
                </button>
              </div>
              <div>
                <button className="touch-nitro" {...touch('nitro', true)}>
                  {t('nitro')}
                </button>
                <button {...touch('brake', 1)}>{t('brake')}</button>
                <button className="touch-throttle" {...touch('throttle', 1)}>
                  {t('throttle')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {!ready && !error && (
        <div className="player-loading">
          <span className="loading-ring" />
          <span className="eyebrow">{t('launching')}</span>
          <h2>MIDNIGHT OUTLAWS</h2>
          <p>{t('launchDescription')}</p>
        </div>
      )}
      {trackBrowser && (
        <TrackBrowser
          language={language}
          current={routeId}
          laps={selectedLaps}
          records={routeRecords}
          onClose={() => setTrackBrowser(false)}
          onSelect={(id, count) => {
            setRouteId(id);
            setSelectedLaps(count);
            setRestartKey((x) => x + 1);
            setTrackBrowser(false);
          }}
        />
      )}
      {ready && paused && !error && (
        <div className="pause-overlay">
          <div className="pause-card">
            <span className="eyebrow">
              {started ? t('pausedTag') : 'MIDNIGHT OUTLAWS / PROTOTYPE'}
            </span>
            <h1>{t(started ? 'racePaused' : 'raceReady')}</h1>
            <p>
              {started ? <GameControlsHint fallback={t('controlsKeyboard')} /> : t('raceReadyBody')}
            </p>
            {!started && (
              <div className="route-selection" aria-label={language === 'ru' ? 'Маршрут' : 'Route'}>
                <button className="button secondary" onClick={() => setTrackBrowser(true)}>
                  {language === 'ru' ? 'Обзор трасс' : 'Browse tracks'}
                </button>
                <GameRouteMap routeId={routeId} overview language={language} />
                {selectableRoutes.map((r) => (
                  <button
                    key={r.id}
                    data-route-option={r.id}
                    className={routeId === r.id ? 'selected' : ''}
                    onClick={() => {
                      setRouteId(r.id);
                      setSelectedLaps(r.kind === 'sprint' ? 1 : r.laps);
                      setRestartKey((x) => x + 1);
                    }}
                  >
                    <strong>{language === 'ru' ? r.nameRu : r.name}</strong>
                    <span>
                      {r.kind === 'sprint'
                        ? language === 'ru'
                          ? 'Спринт'
                          : 'Sprint'
                        : language === 'ru'
                          ? 'Кольцо'
                          : 'Circuit'}{' '}
                      · {(r.length / 1000).toFixed(1)} {language === 'ru' ? 'км' : 'km'}
                    </span>
                  </button>
                ))}
                <small>
                  {language === 'ru'
                    ? 'Маршруты доступны также в сетевом лобби.'
                    : 'Routes are also available in the online lobby.'}
                </small>
              </div>
            )}
            {!started && (
              <div className="solo-modes">
                {routeRegistry.find((r) => r.routeId === routeId)?.kind === 'circuit' && (
                  <label className="route-lap-choice">
                    {language === 'ru' ? 'Круги' : 'Laps'}
                    <select
                      aria-label={language === 'ru' ? 'Круги' : 'Laps'}
                      value={selectedLaps}
                      onChange={(e) => setSelectedLaps(Number(e.target.value))}
                    >
                      {[1, 2, 3].map((n) => (
                        <option value={n} key={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(['practice', 'timeTrial'] as const).map((value) => (
                  <button
                    key={value}
                    className={mode === value ? 'selected' : ''}
                    onClick={() => setMode(value)}
                  >
                    {t(value)}
                  </button>
                ))}
              </div>
            )}
            {history.length > 0 && (
              <details className="personal-laps">
                <summary>{t('personalLapTable')}</summary>
                <ol>
                  {history.map((record, index) => (
                    <li key={`${record.recordedAt}_${index}`}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{timeLabel(record.seconds)}</strong>
                      <time>
                        {new Intl.DateTimeFormat(language, {
                          day: 'numeric',
                          month: 'short',
                        }).format(new Date(record.recordedAt))}
                      </time>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {initialHistory.length > 0 && (
              <details className="personal-laps">
                <summary>
                  {language === 'ru' ? 'Архив прежней трассы' : 'Original circuit archive'}
                  {initialBestLap ? ` · ${timeLabel(initialBestLap)}` : ''}
                </summary>
                <ol>
                  {initialHistory.map((r, i) => (
                    <li key={i}>
                      <span>{i + 1}</span>
                      <strong>{timeLabel(r.seconds)}</strong>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {!started && (
              <details className="start-controls-details">
                <summary>{language === 'ru' ? 'Управление' : 'Controls'}</summary>
                <div className="start-controls">
                  <span>
                    <Gamepad2 size={18} />
                    <GameControlsHint fallback={t('controlsGamepad')} />
                  </span>
                  <span>
                    <GameControlsHint fallback={t('controlsKeyboard')} />
                  </span>
                  <span>{t('controlsTouch')}</span>
                </div>
              </details>
            )}
            {!started && <VehicleSelect language={language} />}
            <GraphicsSettings language={language} />
            <GameAudioSettings language={language} />
            <button
              autoFocus={started}
              data-game-back={started ? true : undefined}
              data-game-resume={started ? true : undefined}
              className="button primary"
              onClick={() => {
                if (started) setPaused(false);
                else void begin();
              }}
              disabled={busy}
            >
              <Play size={17} fill="currentColor" />
              {t(started ? 'resume' : 'startRace')}
              {busy && <LoaderCircle className="spin" size={16} />}
            </button>
            {started && (
              <button
                className="button secondary"
                onClick={() => {
                  setStarted(false);
                  setPaused(true);
                  setRestartKey((x) => x + 1);
                }}
              >
                {language === 'ru' ? 'Другой маршрут' : 'Change route'}
              </button>
            )}
            {started && (
              <button
                className="button secondary"
                onClick={() => {
                  setRestartKey((x) => x + 1);
                  setPaused(false);
                }}
              >
                <RotateCcw size={16} />
                {t('restart')}
              </button>
            )}
            <button
              className="pause-exit"
              data-game-back={!started ? true : undefined}
              onClick={exit}
              disabled={busy}
            >
              <ArrowLeft size={15} />
              {t('exitGame')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="pause-overlay">
          <div className="pause-card">
            <h1>{t('gameError')}</h1>
            <p role="alert">{error}</p>
            <button className="button primary" onClick={exit}>
              {t('exitGame')}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <button className="race-notice" onClick={() => setNotice('')} aria-label={t('close')}>
          {notice}
          <X size={14} />
        </button>
      )}
      <span className="game-sound-status">{t(ui.sound ? 'uiSoundOn' : 'uiSoundOff')}</span>
    </div>
  );
}
