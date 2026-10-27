'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Crosshair,
  LoaderCircle,
  Maximize2,
  Pause,
  Settings2,
  Shield,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type { GameRuntimeContext } from '@/games/players';
import { ForgeNetworking } from '@/games/fold/networking';
import { NexusForgeRuntime, type ForgeFrameStats } from '@/games/fold/runtime';
import type { ForgeSnapshot } from '@/games/fold/contracts';
import { balance } from '@/games/fold/config';
import {
  defaultForgeSettings,
  forgeSettingsSchema,
  type ForgeSettings,
} from '@/games/fold/settings';
import { InputNavigation } from './input-navigation';
import { InputGlyph } from './input-system';
import './fold-player.css';
type Profile = {
  stats: { matches: number; wins: number };
  history: {
    matchId: string;
    result: { details?: { score?: number[] }; place: number | null } | null;
  }[];
};
const emptyStats = {
  fps: 0,
  frameMs: 0,
  onePercentLow: 0,
  p99Ms: 0,
  physicsMs: 0,
  renderMs: 0,
  drawCalls: 0,
};
export function FoldPlayer({
  gameId,
  initialRoom,
  initialSaves,
}: GameRuntimeContext & { initialRoom?: string }) {
  const mount = useRef<HTMLDivElement>(null),
    runtime = useRef<NexusForgeRuntime | null>(null);
  const [network] = useState(() => new ForgeNetworking());
  const [snapshot, setSnapshot] = useState<ForgeSnapshot | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''),
    [panel, setPanel] = useState<'main' | 'settings' | 'profile' | 'friends' | 'pause' | 'none'>(
      'main',
    );
  const [settings, setSettings] = useState<ForgeSettings>(() => {
      const saved = forgeSettingsSchema.safeParse(initialSaves['forge-settings-v1']);
      return saved.success ? saved.data : defaultForgeSettings;
    }),
    settingsRef = useRef(settings);
  const [stats, setStats] = useState<ForgeFrameStats>(emptyStats),
    [hit, setHit] = useState(false),
    [debug, setDebug] = useState(false);
  const [code, setCode] = useState(''),
    [profile, setProfile] = useState<Profile | null>(null),
    [friends, setFriends] = useState<{ id: string; username: string }[]>([]);
  const [audio, setAudio] = useState('locked');
  const initializedRoom = useRef(false),
    previousPhase = useRef('');
  const previousSaved = useRef(false);
  const inMatch = !!snapshot?.game && snapshot.phase !== 'lobby',
    paused =
      panel === 'pause' || panel === 'settings' || panel === 'profile' || panel === 'friends';
  const menu = !inMatch || paused || snapshot?.phase === 'results';
  const me = snapshot?.players.find((p) => p.id === network.userId),
    player = snapshot?.game?.players.find((p) => p.id === network.userId);
  const game = snapshot?.game,
    roundElapsed = game ? (game.tick - game.roundStarted) / 60 : 0;
  async function loadProfile() {
    const r = await fetch('/api/fold-settings');
    if (!r.ok) return;
    const data = await r.json();
    setProfile(data);
    const parsed = forgeSettingsSchema.safeParse(data.settings);
    if (parsed.success) setSettings(parsed.data);
  }
  useEffect(() => {
    if (!mount.current) return;
    let cancelled = false;
    const r = new NexusForgeRuntime(mount.current, network, settingsRef.current);
    runtime.current = r;
    r.onMenu = () => setPanel('pause');
    r.onError = setNotice;
    r.onStats = (s, h) => {
      setStats(s);
      setHit(h);
    };
    r.audio.onStatus = setAudio;
    network.onStatus = setNotice;
    network.onSnapshot = (s) => {
      if (cancelled) return;
      r.receive(s);
      setSnapshot(s);
      if (s.phase === 'countdown' && previousPhase.current === 'lobby') setPanel('none');
      if (s.phase === 'results' && s.saved && !previousSaved.current)
        void fetch('/api/fold-settings')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d && !cancelled) setProfile(d);
          });
      previousPhase.current = s.phase;
      previousSaved.current = s.saved;
    };
    void r
      .initialize()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setNotice('Не удалось загрузить 3D-сцену. Нужен браузер с WebGL 2.');
      });
    void loadProfile();
    return () => {
      cancelled = true;
      network.onSnapshot = () => {};
      network.onStatus = () => {};
      void network.leave();
      r.dispose();
      runtime.current = null;
    };
  }, [network]);
  useEffect(() => {
    settingsRef.current = settings;
    runtime.current?.updateSettings(settings);
  }, [settings]);
  useEffect(() => {
    runtime.current?.setMenu(menu);
  }, [menu]);
  useEffect(() => {
    if (!notice || notice.startsWith('Связь потеряна')) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (initialRoom && ready && !initializedRoom.current) {
      initializedRoom.current = true;
      void connect({ action: 'join', roomId: initialRoom });
    }
    // The invite is consumed once, after assets are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoom, ready]);
  async function connect(action: Record<string, unknown>) {
    setBusy(true);
    setNotice('');
    void runtime.current?.audio.activate();
    try {
      await network.connect({ ...action, gameId, maxPlayers: 2 });
      setPanel('main');
    } catch {
      setNotice('Подключение отклонено. Проверьте код, приглашение и наличие игры в библиотеке.');
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    setBusy(true);
    try {
      await network.leave();
      setSnapshot(null);
      setPanel('main');
      previousPhase.current = '';
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/fold-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setNotice(r.ok ? 'Настройки сохранены в аккаунте' : 'Не удалось сохранить настройки');
    } finally {
      setBusy(false);
    }
  }
  async function openFriends() {
    setPanel('friends');
    const r = await fetch('/api/social');
    if (r.ok) {
      const data = await r.json();
      setFriends(data.friends ?? []);
    }
  }
  const activate = () => {
    void runtime.current?.audio.activate();
    runtime.current?.audio.play('ui');
  };
  const change = <K extends keyof ForgeSettings>(key: K, value: ForgeSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const active = game?.phase === 'active' || game?.phase === 'overtime';
  return (
    <main
      className="forge"
      data-testid="fold-player"
      data-phase={snapshot?.phase ?? 'menu'}
      data-game-phase={game?.phase ?? ''}
      data-loaded={ready}
    >
      <InputNavigation suspended={!menu} />
      <div ref={mount} className="forge-viewport" />
      <header className="forge-top">
        <Link href="/library" aria-label="Вернуться в NEXUS">
          <ArrowLeft size={17} /> NEXUS
        </Link>
        <span className="forge-wordmark">
          FOLD<span>:</span>ZERO
        </span>
        <div>
          <button aria-label="Показатели производительности" onClick={() => setDebug((v) => !v)}>
            FORGE / 01
          </button>
          <button
            aria-label="Полный экран"
            onClick={() => {
              void (document.fullscreenElement
                ? document.exitFullscreen()
                : mount.current?.parentElement?.requestFullscreen());
            }}
          >
            <Maximize2 size={17} />
          </button>
          {inMatch && (
            <button aria-label="Меню игры" onClick={() => setPanel('pause')}>
              <Pause size={18} />
            </button>
          )}
        </div>
      </header>
      {debug && (
        <output
          className="forge-debug"
          data-testid="forge-performance"
        >{`FPS ${stats.fps.toFixed(1)} · 1% ${stats.onePercentLow.toFixed(1)}\nFrame ${stats.frameMs.toFixed(2)} ms · p99 ${stats.p99Ms.toFixed(2)}\nCPU render ${stats.renderMs.toFixed(2)} · physics ${stats.physicsMs.toFixed(2)} ms\nRTT ${network.rtt.toFixed(0)} · jitter ${network.jitter.toFixed(0)} ms\nDraws ${stats.drawCalls} · entities ${game?.players.length ?? 0}`}</output>
      )}
      {notice && (
        <div role="status" className="forge-notice">
          {notice}
          <button aria-label="Закрыть уведомление" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {!ready && (
        <div className="forge-loading">
          <LoaderCircle className="spin" />
          <span>Собираем THE FOUNDRY</span>
        </div>
      )}
      {ready && menu && snapshot?.phase !== 'results' && (
        <div className="forge-menu">
          <section className="forge-intro">
            <span className="forge-kicker">THE FOUNDRY · 1V1</span>
            <h1>
              CHANGE
              <br />
              THE <em>ANGLE.</em>
            </h1>
            <p>
              Один соперник. Три узла.
              <br />
              Арена меняется по твоим правилам.
            </p>
            <span className="forge-development">
              Первый играбельный этап · графика и анимации в разработке
            </span>
          </section>
          <section className="forge-panel" onPointerDown={activate}>
            {panel === 'settings' ? (
              <>
                <div className="forge-panel-title">
                  <h2>Настройки</h2>
                  <button aria-label="Назад" onClick={() => setPanel(inMatch ? 'pause' : 'main')}>
                    <X />
                  </button>
                </div>
                <label>
                  Графика
                  <select
                    aria-label="Графика FOLD"
                    value={settings.quality}
                    onChange={(e) => change('quality', e.target.value as ForgeSettings['quality'])}
                  >
                    {['auto', 'competitive', 'low', 'medium', 'high', 'ultra'].map((q) => (
                      <option key={q} value={q}>
                        {q.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    'mouseSensitivity',
                    'aimSensitivity',
                    'responseCurve',
                    'master',
                    'weapons',
                    'environment',
                    'effects',
                  ] as const
                ).map((key, i) => (
                  <label key={key}>
                    {
                      [
                        'Мышь',
                        'Скорость обзора геймпада',
                        'Кривая стика',
                        'Общая громкость',
                        'Оружие',
                        'Окружение',
                        'Эффекты',
                      ][i]
                    }
                    <input
                      aria-label={key}
                      type="range"
                      min={key === 'responseCurve' ? 1 : key.includes('Sensitivity') ? 0.2 : 0}
                      max={key === 'responseCurve' ? 2.5 : key.includes('Sensitivity') ? 3 : 1}
                      step=".05"
                      value={settings[key]}
                      onChange={(e) => change(key, Number(e.target.value))}
                    />
                  </label>
                ))}
                <label className="forge-check">
                  <input
                    type="checkbox"
                    checked={settings.invertY}
                    onChange={(e) => change('invertY', e.target.checked)}
                  />
                  Инверсия вертикального обзора
                </label>
                <label className="forge-check">
                  <input
                    type="checkbox"
                    checked={settings.headBob}
                    onChange={(e) => change('headBob', e.target.checked)}
                  />
                  Лёгкое покачивание камеры
                </label>
                <Link href="/controllers" className="forge-text-link">
                  Deadzone, переназначение и вибрация <ArrowUpRight size={15} />
                </Link>
                <button className="forge-primary" disabled={busy} onClick={() => void save()}>
                  Сохранить
                </button>
              </>
            ) : panel === 'profile' ? (
              <>
                <div className="forge-panel-title">
                  <h2>Твои дуэли</h2>
                  <button aria-label="Назад" onClick={() => setPanel(inMatch ? 'pause' : 'main')}>
                    <X />
                  </button>
                </div>
                <div className="forge-records">
                  <strong>
                    {profile?.stats.matches ?? 0}
                    <span>МАТЧЕЙ</span>
                  </strong>
                  <strong>
                    {profile?.stats.wins ?? 0}
                    <span>ПОБЕД</span>
                  </strong>
                </div>
                {profile?.history.length ? (
                  profile.history.map((h) => (
                    <div className="forge-history" key={h.matchId}>
                      <span>
                        {h.result?.place === 1
                          ? 'Победа'
                          : h.result?.place === 2
                            ? 'Поражение'
                            : 'Ничья'}
                      </span>
                      <b>{h.result?.details?.score?.join(' : ') ?? '—'}</b>
                      <Shield size={16} />
                    </div>
                  ))
                ) : (
                  <p>Здесь появятся результаты настоящих дуэлей.</p>
                )}
                <Link className="forge-text-link" href="/profile">
                  Профиль NEXUS <ArrowUpRight size={15} />
                </Link>
              </>
            ) : panel === 'friends' ? (
              <>
                <div className="forge-panel-title">
                  <h2>Пригласить друга</h2>
                  <button aria-label="Назад" onClick={() => setPanel(inMatch ? 'pause' : 'main')}>
                    <X />
                  </button>
                </div>
                {!snapshot && <p>Сначала создай приватную дуэль.</p>}
                {friends.map((f) => (
                  <button
                    className="forge-friend"
                    key={f.id}
                    disabled={!snapshot || busy}
                    onClick={() => {
                      setBusy(true);
                      void network
                        .invitePlayer(f.id)
                        .then(() => setNotice('Приглашение отправлено'))
                        .catch(() => setNotice('Приглашение недоступно'))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <span>{f.username}</span>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
                {!friends.length && (
                  <Link href="/friends" className="forge-text-link">
                    Найти друзей в NEXUS <Users size={18} />
                  </Link>
                )}
              </>
            ) : panel === 'pause' && inMatch ? (
              <>
                <span className="forge-kicker">МАТЧ ПРОДОЛЖАЕТСЯ</span>
                <h2>На паузе — только ты.</h2>
                <p>Сервер продолжает дуэль. Пока меню открыто, передаётся нейтральный ввод.</p>
                <button
                  className="forge-primary"
                  onClick={() => {
                    activate();
                    setPanel('none');
                  }}
                >
                  Продолжить
                </button>
                <button className="forge-secondary" onClick={() => setPanel('settings')}>
                  <Settings2 size={18} />
                  Настройки
                </button>
                <button className="forge-text-link" disabled={busy} onClick={() => void leave()}>
                  Покинуть матч
                </button>
              </>
            ) : snapshot ? (
              <>
                <div className="forge-panel-title">
                  <span className="forge-kicker">
                    {snapshot.private ? 'PRIVATE DUEL' : 'QUICK MATCH'}
                  </span>
                  <button aria-label="Выйти из комнаты" onClick={() => void leave()}>
                    <X size={18} />
                  </button>
                </div>
                <h2>THE FOUNDRY</h2>
                <div className="forge-room-code">
                  <span>{snapshot.code}</span>
                  <button
                    aria-label="Скопировать код"
                    onClick={() => {
                      void navigator.clipboard?.writeText(snapshot.code);
                    }}
                  >
                    <Copy size={17} />
                  </button>
                </div>
                <div className="forge-roster">
                  {[0, 1].map((slot) => {
                    const p = snapshot.players.find((p) => p.slot === slot);
                    return (
                      <div key={slot} className={`forge-member team-${slot}`}>
                        <span className="forge-pilot-icon">{slot ? '△' : '◇'}</span>
                        <div>
                          <strong>{p?.username ?? 'Ожидание соперника'}</strong>
                          <small>
                            {p
                              ? p.connected
                                ? 'В комнате'
                                : 'Переподключение…'
                              : 'Ждём реального игрока'}
                          </small>
                        </div>
                        {p?.ready ? <Check size={19} /> : <span className="forge-status-dot" />}
                      </div>
                    );
                  })}
                </div>
                <button
                  className="forge-primary"
                  data-testid="forge-ready"
                  disabled={!ready || busy || !me}
                  onClick={() => network.ready(!me?.ready)}
                >
                  {me?.ready ? 'Снять готовность' : 'Я готов'}
                </button>
                {snapshot.leaderId === network.userId && (
                  <button
                    className="forge-secondary"
                    data-testid="forge-start"
                    disabled={
                      snapshot.players.length !== 2 ||
                      snapshot.players.some((p) => !p.ready || !p.connected)
                    }
                    onClick={() => network.startMatch()}
                  >
                    Начать дуэль <ArrowUpRight size={18} />
                  </button>
                )}
                <button className="forge-text-link" onClick={() => void openFriends()}>
                  <Users size={16} />
                  Пригласить друга
                </button>
                <p className="forge-small">До 5 побед · VECTOR R9 · Core через 45 секунд</p>
              </>
            ) : (
              <>
                <span className="forge-kicker">READY TO RECONFIGURE?</span>
                <h2>Твой следующий угол.</h2>
                <button
                  className="forge-primary"
                  disabled={!ready || busy}
                  onClick={() => void connect({ action: 'quick' })}
                >
                  <Crosshair size={20} />
                  {busy ? 'Подключение…' : 'Quick Match'}
                  <ArrowUpRight size={20} />
                </button>
                <button
                  className="forge-secondary"
                  disabled={!ready || busy}
                  onClick={() => void connect({ action: 'create', private: true })}
                >
                  <Shield size={19} />
                  Private Duel
                </button>
                <form
                  className="forge-join"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connect({ action: 'join', code });
                  }}
                >
                  <input
                    aria-label="Код комнаты FOLD"
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 6),
                      )
                    }
                    placeholder="КОД ИЗ ПРИГЛАШЕНИЯ"
                  />
                  <button disabled={code.length !== 6 || busy} aria-label="Войти по коду">
                    <ArrowUpRight size={20} />
                  </button>
                </form>
                <div className="forge-menu-links">
                  <button onClick={() => setPanel('profile')}>Статистика</button>
                  <button onClick={() => setPanel('settings')}>Настройки</button>
                  <Link href="/friends">Друзья</Link>
                </div>
                <p className="forge-small">
                  Только настоящие соперники. Если очередь пуста, комната ждёт второго игрока.
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {inMatch && !menu && game && player && (
        <>
          <div className="forge-score">
            <b className="team-0">{game.score[0]}</b>
            <div>
              <span>РАУНД {game.round}</span>
              <strong>
                {game.phase === 'prepare'
                  ? Math.max(
                      0,
                      Math.ceil(balance.preparation - (game.tick - game.phaseStarted) / 60),
                    )
                  : game.phase === 'round-end'
                    ? '—'
                    : Math.max(
                        0,
                        Math.ceil(
                          (game.phase === 'overtime'
                            ? balance.roundSeconds + balance.overtimeSeconds
                            : balance.roundSeconds) - roundElapsed,
                        ),
                      )}
              </strong>
            </div>
            <b className="team-1">{game.score[1]}</b>
          </div>
          <div className={`forge-crosshair ${hit ? 'hit' : ''}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="forge-core">
            <span className={roundElapsed >= balance.coreUnlock ? 'active' : ''} />
            {roundElapsed < balance.coreUnlock
              ? `CORE ЧЕРЕЗ ${Math.ceil(balance.coreUnlock - roundElapsed)} c`
              : game.phase === 'overtime'
                ? 'ОВЕРТАЙМ · CORE АКТИВЕН'
                : 'CORE АКТИВЕН'}
            {player.capture > 0 && (
              <b>{Math.min(100, (player.capture / balance.coreCapture) * 100).toFixed(0)}%</b>
            )}
          </div>
          <div className="forge-health">
            <Shield size={21} />
            <strong data-testid="forge-hp">{player.hp}</strong>
            <span>HP</span>
            <i style={{ width: `${player.hp}%` }} />
          </div>
          <div className="forge-ammo">
            <span>VECTOR R9</span>
            <strong data-testid="forge-ammo">
              {player.ammo}
              <small> / 24</small>
            </strong>
            <p>
              {player.reload > 0 ? (
                'ПЕРЕЗАРЯДКА…'
              ) : (
                <>
                  <InputGlyph action="handbrake" fallback="R" /> ПЕРЕЗАРЯДКА
                </>
              )}
            </p>
          </div>
          <div className="forge-tools">
            <div>
              <InputGlyph action="nextSection" fallback="F" />
              <b>{player.foldCharges}</b>
              <span>FOLD</span>
            </div>
            <div>
              <InputGlyph action="previousSection" fallback="Q" />
              <b>{Math.max(0, Math.ceil(player.impulseReady - game.tick / 60)) || '✓'}</b>
              <span>IMPULSE</span>
            </div>
          </div>
          {!active && (
            <div className="forge-round">
              <span>
                {game.phase === 'prepare'
                  ? 'НАЙДИ СВОЙ УГОЛ'
                  : game.roundWinner === network.userId
                    ? 'РАУНД ТВОЙ'
                    : game.roundWinner
                      ? 'РАУНД СОПЕРНИКА'
                      : 'НИЧЬЯ'}
              </span>
              <strong>
                {game.phase === 'prepare'
                  ? `0${Math.max(1, Math.ceil(balance.preparation - (game.tick - game.phaseStarted) / 60))}`
                  : game.reason === 'core-override'
                    ? 'CORE OVERRIDE'
                    : game.reason === 'elimination'
                      ? 'ELIMINATION'
                      : 'OVERTIME'}
              </strong>
            </div>
          )}
          {active && (
            <div className="forge-capture-hint">
              {player.holdingNode ? (
                <>
                  <InputGlyph action="nextSection" fallback="F" /> УДЕРЖИВАЙ · ПЕРЕСТРОИТЬ
                </>
              ) : (
                <>
                  <span>WASD · МЫШЬ / ГЕЙМПАД</span>
                  <small>Клик по сцене — захват мыши</small>
                </>
              )}
            </div>
          )}
        </>
      )}
      {snapshot?.phase === 'results' && game && (
        <div className="forge-results">
          <span className="forge-kicker">ДУЭЛЬ ЗАВЕРШЕНА</span>
          <h1>
            {game.winner === network.userId
              ? 'YOUR ANGLE.'
              : game.winner
                ? 'NEXT ANGLE.'
                : 'EVEN ANGLES.'}
          </h1>
          <div className="forge-final-score">
            <b>{game.score[0]}</b>
            <span>:</span>
            <b>{game.score[1]}</b>
          </div>
          <p>
            {snapshot.saved
              ? 'Результат подтверждён сервером и сохранён'
              : 'Сохраняем серверный результат…'}
          </p>
          {snapshot.leaderId === network.userId && (
            <button
              className="forge-primary"
              disabled={!snapshot.saved}
              onClick={() => network.rematch()}
            >
              Вернуться в лобби
            </button>
          )}
          <button className="forge-secondary" disabled={busy} onClick={() => void leave()}>
            Главное меню
          </button>
        </div>
      )}
      {ready && audio !== 'running' && (
        <button
          className="forge-audio-unlock"
          onClick={() => {
            void runtime.current?.audio.activate();
          }}
        >
          <Volume2 size={16} />
          {audio === 'unavailable' ? 'Аудио недоступно' : 'Включить звук'}
        </button>
      )}
    </main>
  );
}
