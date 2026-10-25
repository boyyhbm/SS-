'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Flag,
  Gamepad2,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NexusMultiplayerSDK } from '@/multiplayer/sdk';
import { RacePrediction } from '@/multiplayer/prediction';
import type { InputCommand } from '@/multiplayer/contracts';
import type { RaceState } from '@/games/racing-physics';
import { multiplayerText, multiplayerError, type MultiplayerText } from '@/multiplayer/i18n';
import { cars, type RoomSnapshot, type RoomSummary } from '@/multiplayer/contracts';
import type { RaceNetworkDriver } from '@/multiplayer/prediction';
import type { SocialData } from '@/multiplayer/social-types';
import type { RaceTelemetry } from '@/games/midnight-outlaws';
import { timeLabel, type RaceInput } from '@/games/racing-physics';
import type { Language } from '@/lib/i18n';
import { playSound } from '@/lib/ui-store';
import { consoleReturn } from '@/input/focus';
import { GameControlsHint } from './input-system';
import { nexusInput } from '@/input/manager';
import { RaceHUD, GraphicsSettings } from './race-hud';
import { InputNavigation } from './input-navigation';
const Race = dynamic(() => import('@/games/midnight-outlaws').then((m) => m.MidnightOutlaws), {
  ssr: false,
});
export function OnlinePlayer({
  gameId,
  slug,
  title,
  userId,
  language,
  initialRoom,
  partySearch,
}: {
  gameId: string;
  slug: string;
  title: string;
  userId: string;
  language: Language;
  initialRoom?: string;
  partySearch?: boolean;
}) {
  const router = useRouter();
  const t = useCallback((key: MultiplayerText) => multiplayerText(language, key), [language]);
  const [sdk] = useState(
    () =>
      new NexusMultiplayerSDK<RaceState, InputCommand, RacePrediction>(
        (id, send) => new RacePrediction(id, send),
      ),
  );
  const previousPhase = useRef<string>('');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [social, setSocial] = useState<SocialData | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [privateRoom, setPrivateRoom] = useState(true),
    [maxPlayers, setMaxPlayers] = useState(6),
    [code, setCode] = useState('');
  const [menu, setMenu] = useState(false),
    [renderReady, setRenderReady] = useState(false),
    [connected, setConnected] = useState(true);
  const [quality, setQuality] = useState({ rtt: 0, jitter: 0 });
  const [interactive, setInteractive] = useState(false),
    [mobile, setMobile] = useState(false);
  const [telemetry, setTelemetry] = useState<RaceTelemetry>({
    speed: 0,
    nitro: 100,
    lap: 1,
    lapTime: 0,
    bestLap: null,
    nextCheckpoint: 1,
    collision: false,
    x: 95,
    z: 0,
    heading: 0,
  });
  const network = useRef<RaceNetworkDriver | null>(null),
    root = useRef<HTMLDivElement>(null);
  const input = useRef<RaceInput>({ throttle: 0, brake: 0, steer: 0, nitro: false });
  const [now, setNow] = useState(0);
  const me = snapshot?.players.find((p) => p.id === userId);
  const leader = snapshot?.leaderId === userId;
  const playing = snapshot?.phase === 'racing' || snapshot?.phase === 'countdown';
  const canStart =
    leader &&
    snapshot.phase === 'lobby' &&
    snapshot.players.length >= 2 &&
    snapshot.players.every((p) => p.ready && p.connected);
  useEffect(() => {
    setInteractive(true);
    setMobile(window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 850);
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    const offState = sdk.receiveState((state) => {
      setSnapshot(state);
      if (previousPhase.current !== state.phase) {
        if (state.phase === 'countdown') void nexusInput.haptic('start');
        if (state.phase === 'results') void nexusInput.haptic('finish');
        previousPhase.current = state.phase;
      }
      setConnected(sdk.connected);
    });
    const offEvent = sdk.onEvent((type, username) => {
      setNotice(`${username ? `${username} · ` : ''}${multiplayerError(language, type)}`);
      setConnected(sdk.connected);
      if (type === 'roomClosed') {
        setSnapshot(null);
        network.current = null;
      }
    });
    const timer = setInterval(() => {
      setQuality({ rtt: sdk.rtt, jitter: sdk.jitter });
      setNow(Date.now());
    }, 250);
    return () => {
      offState();
      offEvent();
      clearInterval(timer);
      void sdk.leaveRoom();
      network.current = null;
    };
  }, [sdk, language]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const res = await fetch('/api/social', { cache: 'no-store' });
        if (!res.ok || disposed) return;
        const data: SocialData = await res.json();
        setSocial(data);
        setRooms(data.network?.rooms.filter((r) => r.gameId === gameId) ?? []);
      } catch {
        /* Explicit join requests report network failures. */
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [gameId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const pause = useCallback(() => setMenu((value) => !value), []);
  async function connect(kind: 'quick' | 'create' | 'join', roomId?: string, byCode = false) {
    if (!interactive || mobile || busy) return;
    setBusy(true);
    setError('');
    setRenderReady(false);
    try {
      if (kind === 'quick') await sdk.quickMatch(gameId, !!partySearch);
      else if (kind === 'create') await sdk.createRoom(gameId, privateRoom, maxPlayers);
      else if (byCode) await sdk.connect({ action: 'join', gameId, code });
      else await sdk.connect({ action: 'join', gameId, roomId: roomId!, party: !!partySearch });
      network.current = sdk.prediction;
      setConnected(true);
      playSound('confirm');
      setNotice(t('matchFound'));
    } catch (e) {
      setError(multiplayerError(language, e instanceof Error ? e.message : 'networkUnavailable'));
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    setBusy(true);
    try {
      await sdk.cancelSearch();
    } finally {
      network.current = null;
      setSnapshot(null);
      setMenu(false);
      setRenderReady(false);
      setBusy(false);
    }
  }
  async function invite(target: string) {
    try {
      await sdk.invitePlayer(target);
      setNotice(t('inviteSent'));
    } catch {
      setError(t('socialNotAllowed'));
    }
  }
  return (
    <div
      ref={root}
      className={`online-console ${playing ? 'online-playing' : ''}`}
      data-testid="online-player"
      data-phase={snapshot?.phase ?? 'browse'}
      data-room={snapshot?.roomId}
      data-match={snapshot?.matchId}
      data-player-count={snapshot?.players.length ?? 0}
      data-x={telemetry.x}
      data-z={telemetry.z}
      data-speed={telemetry.speed}
      data-heading={telemetry.heading}
      data-remote-x={snapshot?.players.find((p) => p.id !== userId)?.state.x}
      data-ready={renderReady}
    >
      <InputNavigation suspended={!!playing && !menu} />
      {snapshot && (
        <Race
          key={snapshot.roomId}
          presentationKey={`${snapshot.roomId}:${snapshot.phase}`}
          language={language}
          paused={!playing || menu || !connected}
          onReady={() => setRenderReady(true)}
          onError={() => setError(t('networkUnavailable'))}
          onLap={() => {}}
          onTelemetry={setTelemetry}
          inputRef={input}
          onPause={pause}
          restartKey={0}
          initialBestLap={null}
          networkRef={network}
        />
      )}
      {!snapshot && <div className="online-art" />}
      <header className="online-topbar">
        <Link href="/" className="player-brand" aria-label={t('exit')}>
          N<span>/</span>
        </Link>
        <div>
          <span className="eyebrow">{t('onlineTag')}</span>
          <strong>{title}</strong>
        </div>
        <div
          className={`connection-quality ${quality.rtt > 180 || quality.jitter > 45 ? 'poor' : ''}`}
          aria-label={t('network')}
        >
          <Wifi size={16} />
          <span>{snapshot && quality.rtt > 0 ? Math.round(quality.rtt) : '—'} ms</span>
          {quality.rtt > 180 && <small>{t('unstable')}</small>}
        </div>
        <button
          className="icon-button"
          aria-label={t('fullscreen')}
          onClick={() => {
            void (
              document.fullscreenElement
                ? document.exitFullscreen()
                : root.current?.requestFullscreen()
            )?.catch(() => setNotice(t('error')));
          }}
        >
          <Maximize2 size={18} />
        </button>
        {playing && (
          <button className="icon-button" aria-label={t('menu')} onClick={pause}>
            <Pause size={19} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={t('exit')}
          onClick={async () => {
            await sdk.leaveRoom();
            router.push(consoleReturn().path);
            router.refresh();
          }}
        >
          <X size={22} />
        </button>
      </header>
      {notice && (
        <div className="online-notice" role="status">
          <Radio size={16} />
          {notice}
        </div>
      )}
      {error && (
        <div className="online-error" role="alert">
          {error}
          <button className="icon-button" aria-label={t('back')} onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <AnimatePresence mode="wait">
        {!snapshot ? (
          <motion.main
            key="browse"
            className="online-browser"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="online-intro">
              <span className="eyebrow">
                <span className="live-dot" /> NEXUS MULTIPLAYER
              </span>
              <h1>
                MIDNIGHT
                <br />
                <em>TOGETHER.</em>
              </h1>
              <p>{t('onlineBody')}</p>
              <div className="online-specs">
                <span>
                  <Users size={16} />
                  2—6
                </span>
                <span>
                  <Globe2 size={16} />
                  Europe
                </span>
                <span>
                  <Flag size={16} />
                  {t('ghost')}
                </span>
              </div>
            </div>
            <div className="online-selection">
              <section className="quick-match-card">
                <span className="quick-match-icon">
                  <Gamepad2 size={35} />
                </span>
                <div>
                  <span className="eyebrow">01 / FIND YOUR GRID</span>
                  <h2>{t('quickMatch')}</h2>
                  <p>{partySearch ? t('partySearch') : t('waitingBody')}</p>
                </div>
                <button
                  className="button primary"
                  disabled={!interactive || busy || mobile}
                  onClick={() => connect('quick')}
                >
                  {busy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <Play size={18} fill="currentColor" />
                  )}
                  {t('quickMatch')}
                  <ArrowRight size={17} />
                </button>
                {partySearch && <p className="muted">{t('partyWaiting')}</p>}
              </section>
              {mobile && <p className="mobile-online-note">{t('noMobileOnline')}</p>}
              {initialRoom && (
                <button
                  className="button invitation-join"
                  disabled={!interactive || busy || mobile}
                  onClick={() => connect('join', initialRoom)}
                >
                  <Users size={20} />
                  {t('gameInvite')}
                  <strong>{t('join')}</strong>
                  <ArrowRight size={18} />
                </button>
              )}
              {partySearch && social?.network?.partyRoomId && (
                <button
                  className="button invitation-join"
                  disabled={!interactive || busy || mobile}
                  onClick={() => connect('join', social.network!.partyRoomId!)}
                >
                  {t('party')}
                  <strong>{t('join')}</strong>
                </button>
              )}
              <div className="room-setup">
                <div>
                  <h3>{t('createRoom')}</h3>
                  <div className="visibility-switch">
                    <button
                      className={privateRoom ? 'selected' : ''}
                      onClick={() => setPrivateRoom(true)}
                    >
                      <LockKeyhole size={14} />
                      {t('privateRoom')}
                    </button>
                    <button
                      className={!privateRoom ? 'selected' : ''}
                      onClick={() => setPrivateRoom(false)}
                    >
                      <Globe2 size={14} />
                      {t('publicRoom')}
                    </button>
                  </div>
                  <label className="room-capacity">
                    <Users size={15} />
                    <select
                      aria-label={t('members')}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button secondary"
                    disabled={!interactive || busy || mobile}
                    onClick={() => connect('create')}
                  >
                    {t('createRoom')}
                    <ArrowUpIcon />
                  </button>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connect('join', undefined, true);
                  }}
                >
                  <h3>{t('joinCode')}</h3>
                  <input
                    aria-label={t('roomCode')}
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 6),
                      )
                    }
                    placeholder="A1B2C3"
                    pattern="[A-Z0-9]{6}"
                    required
                  />
                  <p>{t('codeHint')}</p>
                  <button className="button secondary" disabled={!interactive || busy || mobile}>
                    {t('join')}
                    <ArrowRight size={17} />
                  </button>
                </form>
              </div>
              <section className="room-list">
                <h3>
                  {t('availableRooms')}
                  <span>{rooms.length}</span>
                </h3>
                {rooms.length ? (
                  rooms.map((room) => (
                    <button
                      key={room.roomId}
                      className="room-tile"
                      disabled={busy || mobile}
                      onClick={() => connect('join', room.roomId)}
                    >
                      <span className="room-tile-icon">
                        <Flag size={22} />
                      </span>
                      <div>
                        <strong>NIGHT CIRCUIT / {room.code}</strong>
                        <span>
                          Europe · {room.players}/{room.maxPlayers}
                        </span>
                      </div>
                      <ArrowRight size={18} />
                    </button>
                  ))
                ) : (
                  <p>{t('noRooms')}</p>
                )}
              </section>
              <Link className="back-link" href={`/play/${slug}`}>
                <ArrowLeft size={16} />
                {t('singlePlayer')}
              </Link>
            </div>
          </motion.main>
        ) : snapshot.phase === 'lobby' ? (
          <motion.main
            key="lobby"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="lobby-layout"
          >
            <section className="lobby-panel">
              <span className="eyebrow">
                {snapshot.private ? <LockKeyhole size={13} /> : <Globe2 size={13} />}{' '}
                {t(snapshot.private ? 'privateRoom' : 'publicRoom')} / EUROPE
              </span>
              <h1>{t('lobby')}</h1>
              <div className="room-code">
                <span>{t('roomCode')}</span>
                <strong data-testid="room-code">{snapshot.code}</strong>
              </div>
              <div className="lobby-roster">
                {snapshot.players.map((p, index) => (
                  <motion.div
                    layout
                    className={`lobby-person ${p.ready ? 'is-ready' : ''}`}
                    key={p.id}
                    data-testid={`lobby-${p.id}`}
                  >
                    <span className="grid-position">0{index + 1}</span>
                    <span className={`avatar avatar-${p.avatar}`}>
                      {p.username[0].toUpperCase()}
                    </span>
                    <div>
                      <strong>
                        {p.username} {p.id === snapshot.leaderId && <Crown size={13} />}
                      </strong>
                      <span>
                        {t(p.car)} /{' '}
                        {p.connected ? t(p.ready ? 'ready' : 'notReady') : t('reconnecting')}
                      </span>
                    </div>
                    <span className="ready-indicator">{p.ready ? <Check size={18} /> : <i />}</span>
                  </motion.div>
                ))}
                {Array.from(
                  { length: Math.max(0, snapshot.maxPlayers - snapshot.players.length) },
                  (_, i) => (
                    <div className="lobby-empty-slot" key={i}>
                      <PlusPlaceholder />
                      {t('waiting')}
                    </div>
                  ),
                )}
              </div>
              {snapshot.players.length < 2 && (
                <p className="lobby-waiting">
                  <span className="loading-ring" />
                  {t('waitingBody')}
                </p>
              )}
              <div className="lobby-actions">
                <button
                  className={`button ${me?.ready ? 'secondary' : 'primary'}`}
                  disabled={!renderReady || !connected}
                  onClick={() => sdk.ready(!me?.ready)}
                >
                  <Check size={18} />
                  {t(me?.ready ? 'unsetReady' : 'setReady')}
                </button>
                {leader && (
                  <button
                    className="button primary"
                    disabled={!canStart}
                    onClick={() => {
                      sdk.startMatch();
                      playSound('launch');
                    }}
                  >
                    <Play size={17} />
                    {t('startMatch')}
                  </button>
                )}
              </div>
              <p className="lobby-help">{t('startHint')}</p>
              <button className="text-button" disabled={busy} onClick={leave}>
                {t(snapshot.private ? 'leaveRoom' : 'cancelSearch')}
              </button>
            </section>
            <aside className="lobby-customize">
              <span className="eyebrow">NEXUS GARAGE / 01</span>
              <h2>{t('car')}</h2>
              <div className="car-swatches">
                {cars.map((car) => (
                  <button
                    key={car}
                    className={`car-swatch swatch-${car} ${me?.car === car ? 'selected' : ''}`}
                    aria-label={t(car)}
                    onClick={() => sdk.chooseCar(car)}
                  >
                    <i />
                    {t(car)}
                    {me?.car === car && <Check size={14} />}
                  </button>
                ))}
              </div>
              {leader && (
                <label className="lap-settings">
                  {t('laps')}
                  <select
                    aria-label={t('laps')}
                    value={snapshot.laps}
                    onChange={(e) => sdk.configure(Number(e.target.value))}
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              )}
              <p className="lobby-control-note">
                <GameControlsHint fallback={t('raceControls')} />
              </p>
              <section className="lobby-friends">
                <h3>{t('invite')}</h3>
                {social?.friends.map((f) => (
                  <div className="person-row" key={f.id}>
                    <span className={`avatar avatar-${f.avatar}`}>
                      {f.username[0].toUpperCase()}
                    </span>
                    <strong>{f.username}</strong>
                    <button
                      className="button secondary small"
                      disabled={snapshot.players.some((p) => p.id === f.id)}
                      onClick={() => invite(f.id)}
                    >
                      {t('invite')}
                    </button>
                  </div>
                ))}
                {!social?.friends.length && (
                  <Link href="/friends" className="back-link">
                    <Users size={16} />
                    {t('addFriend')}
                  </Link>
                )}
              </section>
            </aside>
          </motion.main>
        ) : snapshot.phase === 'results' ? (
          <motion.main
            key="results"
            className="online-results"
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="eyebrow">NIGHT CIRCUIT / CLASSIFICATION</span>
            <h1>{t('results')}</h1>
            <p>
              {t('verified')} · {snapshot.saved ? t('saved') : t('saving')}
            </p>
            <div className="results-list">
              {[...snapshot.players]
                .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
                .map((p) => (
                  <div className={`result-row ${p.id === userId ? 'is-you' : ''}`} key={p.id}>
                    <strong className="result-place">{p.place ? `0${p.place}` : '—'}</strong>
                    <span className={`avatar avatar-${p.avatar}`}>
                      {p.username[0].toUpperCase()}
                    </span>
                    <div>
                      <strong>{p.username}</strong>
                      <span>{t(p.car)}</span>
                    </div>
                    <strong>{p.finish !== null ? timeLabel(p.finish) : t('dnf')}</strong>
                  </div>
                ))}
            </div>
            <div className="results-actions">
              {leader && (
                <button
                  className="button primary"
                  disabled={!snapshot.saved}
                  onClick={() => sdk.rematch()}
                >
                  <RotateCcw size={18} />
                  {t('rematch')}
                </button>
              )}
              <button className="button secondary" onClick={leave}>
                {t('leaveRoom')}
              </button>
              <Link href="/friends" className="back-link">
                {t('history')}
                <ArrowRight size={15} />
              </Link>
            </div>
          </motion.main>
        ) : null}
      </AnimatePresence>
      {playing && snapshot && (
        <>
          <div className="online-position-list">
            {[...snapshot.players]
              .sort(
                (a, b) =>
                  (a.place ?? 99) - (b.place ?? 99) ||
                  b.state.lap - a.state.lap ||
                  b.state.nextCheckpoint - a.state.nextCheckpoint,
              )
              .map((p) => (
                <div key={p.id} className={p.id === userId ? 'is-you' : ''}>
                  <span className={`car-dot swatch-${p.car}`} />
                  <strong>{p.username}</strong>
                  <span>
                    {p.finish !== null
                      ? timeLabel(p.finish)
                      : `${t('lap')} ${Math.min(p.state.lap, snapshot.laps)}/${snapshot.laps}`}
                  </span>
                </div>
              ))}
          </div>
          <RaceHUD
            telemetry={telemetry}
            language={language}
            online
            position={
              snapshot.players.filter(
                (p) =>
                  (p.place !== null && p.place < (me?.place ?? 99)) ||
                  p.state.lap > telemetry.lap ||
                  (p.state.lap === telemetry.lap &&
                    p.state.nextCheckpoint > telemetry.nextCheckpoint),
              ).length + 1
            }
            players={snapshot.players.length}
          />
          <div className="online-controls-hint">
            <GameControlsHint fallback={t('raceControls')} />
          </div>
          {snapshot.phase === 'countdown' && (
            <div className="race-countdown">
              <span>{t('countdown')}</span>
              <strong>
                {snapshot.startsAt
                  ? Math.max(
                      1,
                      Math.ceil((snapshot.startsAt - now - (sdk.prediction?.offset ?? 0)) / 1000),
                    )
                  : '—'}
              </strong>
            </div>
          )}
          {me?.finish !== null && snapshot.phase === 'racing' && (
            <div className="race-finish-badge">
              <Flag size={23} />
              {me?.place ? `#${me.place}` : ''} · {me?.finish ? timeLabel(me.finish) : ''}
            </div>
          )}
        </>
      )}
      {!connected && snapshot && (
        <div className="reconnecting-banner" role="status">
          <LoaderCircle className="spin" size={18} />
          {t('reconnecting')}
          <span>30 s</span>
        </div>
      )}
      {snapshot && !renderReady && (
        <div className="player-loading">
          <span className="loading-ring" />
          <h2>MIDNIGHT OUTLAWS</h2>
          <p>{t('loading')}</p>
        </div>
      )}
      {playing && menu && (
        <div className="pause-overlay">
          <div className="pause-card">
            <span className="eyebrow">NEXUS ONLINE</span>
            <h1>{t('pauseOnline')}</h1>
            <p>{t('pauseOnlineBody')}</p>
            <GraphicsSettings language={language} />
            <button
              autoFocus
              data-game-back
              data-game-resume
              className="button primary"
              onClick={() => setMenu(false)}
            >
              <Play size={17} />
              {t('resume')}
            </button>
            <button className="button secondary" onClick={leave}>
              {t('leaveRoom')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function ArrowUpIcon() {
  return <ArrowRight size={17} style={{ transform: 'rotate(-45deg)' }} />;
}
function PlusPlaceholder() {
  return <span className="empty-slot-mark">+</span>;
}
