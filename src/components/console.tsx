'use client';
import { ConsoleStage } from './console-stage';
import { cityRoutes } from '@/games/road-network';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Gamepad2,
  Grid2X2,
  Heart,
  Library,
  LoaderCircle,
  LogOut,
  Monitor,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { ConsoleData, GameDTO, LibraryDTO, SettingsDTO } from '@/lib/data';
import { dictionary, translate, type TextKey } from '@/lib/i18n';
import { useUI, playSound } from '@/lib/ui-store';
import { isPlayable } from '@/games/registry';
import { InputNavigation } from './input-navigation';
import { InputGlyph, GameControlsHint } from './input-system';
import { ControllerSettings } from './controller-settings';
import { inputText } from '@/input/i18n';
import { confirmWithController, rememberReturn, consoleReturn } from '@/input/focus';
import { Modal } from './modal';
import { AdminPanel } from './admin-panel';
import { SocialHub, SocialPresence, FriendsDrawer } from './social-hub';
import { multiplayerText } from '@/multiplayer/i18n';
import { multiplayerCapabilities } from '@/multiplayer/adapters';
import { updatePreferencesAction } from '@/app/actions';
export type ConsoleView =
  'home' | 'discover' | 'library' | 'game' | 'profile' | 'admin' | 'friends' | 'controllers';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="NEXUS">
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      <span>
        NEXUS<span className="brand-dot">™</span>
      </span>
    </Link>
  );
}
function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
export function Console({
  initialData,
  view,
  slug,
}: {
  initialData: ConsoleData;
  view: ConsoleView;
  slug?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const ui = useUI();
  const t = (key: TextKey) => dictionary[ui.language][key];
  const [selectedId, setSelectedId] = useState(data.library[0]?.gameId ?? data.games[0]?.id ?? '');
  useEffect(() => {
    const restored = consoleReturn().gameId;
    const valid =
      view === 'home' && data.user
        ? data.library.some((e) => e.gameId === restored)
        : data.games.some((g) => g.id === restored);
    if (valid) setSelectedId(restored);
  }, [view, data.user, data.library, data.games]);
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('all');
  const [sort, setSort] = useState('added');
  const [favorites, setFavorites] = useState(false);
  const [contextGame, setContextGame] = useState<string | null>(null);
  useEffect(() => {
    const context = (event: Event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-game-id]');
      if (target?.dataset.gameId) setContextGame(target.dataset.gameId);
    };
    document.addEventListener('nexus-context', context);
    return () => document.removeEventListener('nexus-context', context);
  }, []);
  const [dialog, setDialog] = useState<'search' | 'notifications' | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [pending, startTransition] = useTransition();
  const [clock, setClock] = useState('');
  useEffect(() => {
    document.documentElement.lang = ui.language;
    document.documentElement.dataset.reducedMotion = String(ui.reducedMotion);
  }, [ui.language, ui.reducedMotion]);
  useEffect(() => {
    const settings = initialData.user?.settings;
    if (settings)
      useUI.getState().setPreferences({
        language: settings.language,
        sound: settings.uiSoundEnabled,
        reducedMotion: settings.reducedMotion,
        background: settings.backgroundEffectsEnabled,
      });
  }, [initialData.user?.settings]);
  useEffect(() => {
    const update = () =>
      setClock(
        new Intl.DateTimeFormat(ui.language === 'ru' ? 'ru-RU' : 'en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      );
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [ui.language]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const game =
    view === 'game'
      ? (data.games.find((g) => g.slug === slug) ??
        data.library.find((e) => e.game.slug === slug)?.game)
      : (data.games.find((g) => g.id === selectedId) ??
        data.library.find((e) => e.gameId === selectedId)?.game ??
        data.games[0]);
  const owned = game ? data.library.find((entry) => entry.gameId === game.id) : undefined;
  const emptyHome = view === 'home' && !!data.user && !data.library.length;
  const hero = view === 'discover' || view === 'game';
  const nav = [
    { view: 'home', href: '/', label: t('home'), icon: Grid2X2 },
    { view: 'discover', href: '/discover', label: t('discover'), icon: Compass },
    { view: 'library', href: '/library', label: t('library'), icon: Library },
    {
      view: 'friends',
      href: '/friends',
      label: multiplayerText(ui.language, 'friends'),
      icon: Users,
    },
  ];
  async function refresh() {
    const res = await fetch('/api/console', { cache: 'no-store' });
    if (!res.ok) throw new Error('serverError');
    setData(await res.json());
    router.refresh();
  }
  async function libraryAction(target: GameDTO, action: 'add' | 'remove' | 'favorite') {
    if (!data.user) {
      router.push(`/login?next=${encodeURIComponent(`/games/${target.slug}`)}`);
      return;
    }
    if (action === 'remove' && !(await confirmWithController(t('removeConfirm')))) return;
    setBusy(target.id);
    setError('');
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: target.id, action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await refresh();
      setToast(t(action === 'add' ? 'added' : action === 'remove' ? 'removed' : 'favoriteUpdated'));
      playSound(action === 'add' ? 'add' : 'confirm');
    } catch (e) {
      setError(translate(ui.language, e instanceof Error ? e.message : 'serverError'));
    } finally {
      setBusy('');
    }
  }
  function launch(target: GameDTO) {
    rememberReturn(location.pathname, target.id);
    playSound('launch');
    if (target.runtimeKey === 'nfs-underground') {
      // COOP/COEP require a document response; an SPA transition cannot enable isolation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign(`/play/${target.slug}`);
      return;
    }
    startTransition(() => router.push(`/play/${target.slug}`));
  }
  function select(target: GameDTO) {
    rememberReturn(location.pathname, target.id);
    setSelectedId(target.id);
    playSound('focus');
  }
  const description = game ? (ui.language === 'ru' ? game.description : game.descriptionEn) : '';
  const searchResults = data.games.filter((g) =>
    g.title.toLowerCase().includes(query.toLowerCase()),
  );
  const entries = data.library
    .filter(
      (e) =>
        (genre === 'all' || e.game.genre === genre) &&
        (!favorites || e.isFavorite) &&
        e.game.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.game.title.localeCompare(b.game.title)
        : sort === 'played'
          ? new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime()
          : new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
    );
  function card(target: GameDTO, entry?: LibraryDTO, selectable = false) {
    return (
      <GameCard
        key={target.id}
        game={target}
        entry={entry}
        selected={selectedId === target.id && selectable}
        onSelect={selectable ? () => select(target) : undefined}
        onFavorite={() => libraryAction(target, 'favorite')}
        language={ui.language}
        busy={busy === target.id}
      />
    );
  }
  function actions(target: GameDTO, entry?: LibraryDTO) {
    const playable = isPlayable(target);
    return (
      <div className="hero-actions">
        {entry &&
          playable &&
          target.runtimeKey &&
          multiplayerCapabilities(target.runtimeKey)?.onlineMultiplayer && (
            <Link
              className="button online-action"
              onClick={() => rememberReturn(location.pathname, target.id)}
              href={`/online/${target.slug}`}
            >
              <Users size={18} />
              {multiplayerText(ui.language, 'multiplayer')}
            </Link>
          )}
        {entry && playable ? (
          <button className="button primary" onClick={() => launch(target)} disabled={pending}>
            <Play size={18} fill="currentColor" />
            {pending
              ? t('loading')
              : target.runtimeKey === 'nfs-underground'
                ? ui.language === 'ru'
                  ? 'Настроить / запустить'
                  : 'Setup / Launch'
                : t('playNow')}
            <InputGlyph action="confirm" fallback="↵" />
          </button>
        ) : playable ? (
          <button
            className="button primary"
            onClick={() => libraryAction(target, 'add')}
            disabled={busy === target.id}
          >
            {busy === target.id ? <LoaderCircle className="spin" size={18} /> : <Plus size={20} />}{' '}
            {t('add')}
          </button>
        ) : (
          <span className="button disabled">
            <Clock3 size={18} />
            {t(target.status === 'COMING_SOON' ? 'comingSoon' : 'unavailable')}
          </span>
        )}
        {view !== 'game' && (
          <Link className="button secondary" href={`/games/${target.slug}`}>
            {t('details')}
            <ArrowRight size={17} />
          </Link>
        )}
        {entry && (
          <button
            className={`icon-button favorite-button ${entry.isFavorite ? 'is-favorite' : ''}`}
            onClick={() => libraryAction(target, 'favorite')}
            aria-label={t(entry.isFavorite ? 'unfavorite' : 'favorite')}
            disabled={busy === target.id}
          >
            <Heart size={22} fill={entry.isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    );
  }
  return (
    <MotionConfig reducedMotion={ui.reducedMotion ? 'always' : 'user'}>
      <div className={`console-shell os-console os-${view} ${!ui.background ? 'no-ambient' : ''}`}>
        <InputNavigation />
        <header className="topbar">
          <Brand />
          <nav aria-label={t('home')}>
            {nav.map((item) => (
              <Link
                key={item.view}
                href={item.href}
                data-section-link
                data-focus-key={`section-${item.view}`}
                data-library-link={item.view === 'library' ? 'true' : undefined}
                className={`nav-link ${view === item.view ? 'active' : ''}`}
                onClick={() => playSound('confirm')}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
                {view === item.view && <motion.i layoutId="nav-indicator" />}
              </Link>
            ))}
          </nav>
          <div className="topbar-tools">
            <Link
              className="icon-button controller-nav-link"
              href="/controllers"
              data-controller-settings
              aria-label={inputText(ui.language, 'controllerSettings')}
            >
              <Gamepad2 size={20} />
            </Link>
            <button
              className="icon-button"
              aria-label={t('search')}
              onClick={() => {
                setQuery('');
                setDialog('search');
              }}
            >
              <Search size={20} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label={t('notifications')}
              onClick={() => setDialog('notifications')}
            >
              <Bell size={19} />
            </button>
            <span className="tool-divider" />
            {data.user ? (
              <Link href="/profile" className="profile-chip">
                <span className={`avatar avatar-${data.user.avatar}`}>
                  {data.user.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile-chip-name">{data.user.username}</span>
              </Link>
            ) : (
              <Link href="/login" className="signin-link">
                {t('signIn')}
                <ArrowRight size={16} />
              </Link>
            )}
            <Link
              className="icon-button settings-link"
              href={data.user ? '/profile#settings' : '/login'}
              aria-label={t('settings')}
            >
              <Settings2 size={20} />
            </Link>
          </div>
        </header>
        <main className={`console-main view-${view}`}>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label={t('close')}>
                <X size={18} />
              </button>
            </div>
          )}
          {hero && game && (
            <>
              {view !== 'game' && (
                <div className="welcome-bar">
                  <div>
                    <span className="eyebrow muted">
                      {data.user ? `${t('welcomeBack')}, ${data.user.username}` : 'NEXUS ORIGINALS'}
                    </span>
                    <h1>{view === 'discover' ? t('discoverGames') : t('yourSpace')}</h1>
                  </div>
                  <span className="edition">{t('consoleEdition')}</span>
                </div>
              )}
              {view === 'game' && (
                <Link href="/discover" className="back-link">
                  <ArrowLeft size={16} />
                  {t('catalog')}
                </Link>
              )}
              <section
                className={`hero art-${game.slug} ${view === 'game' ? 'detail-hero' : ''}`}
                aria-label={game.title}
              >
                <AnimatePresence mode="sync">
                  <motion.img
                    key={game.id}
                    className="hero-art"
                    src={game.banner}
                    alt=""
                    initial={{ opacity: 0, scale: 1.035 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.65 }}
                  />
                </AnimatePresence>
                <div className="hero-shade" />
                <div className="hero-grain" />
                <motion.div
                  className="hero-content"
                  key={`${game.id}-${emptyHome}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <div className="hero-kicker">
                    <span className="live-dot" />
                    {emptyHome
                      ? t('welcome')
                      : game.runtimeKey === 'nfs-underground'
                        ? ui.language === 'ru'
                          ? 'ЭКСПЕРИМЕНТАЛЬНАЯ ИНТЕГРАЦИЯ'
                          : 'EXPERIMENTAL INTEGRATION'
                        : t(isPlayable(game) ? 'prototype' : 'comingSoon')}
                    <span className="kicker-line" />
                  </div>
                  <h2 className={emptyHome ? 'hero-welcome' : ''}>
                    {emptyHome ? (
                      t('emptyLibrary')
                    ) : game.title === 'MIDNIGHT OUTLAWS' ? (
                      <>
                        MIDNIGHT
                        <br />
                        <span>OUTLAWS</span>
                      </>
                    ) : (
                      game.title.split(' ').map((word, index) => <span key={index}>{word} </span>)
                    )}
                  </h2>
                  <div className="hero-meta">
                    <span>{t(game.genre as TextKey)}</span>
                    <i />
                    {isPlayable(game) ? (
                      <>
                        <span>
                          {game.runtimeKey === 'nfs-underground' ? 'Своя копия' : t('free')}
                        </span>
                        <i />
                        <Gamepad2 size={15} />
                        <Monitor size={14} />
                      </>
                    ) : (
                      <span>{t('comingSoon')}</span>
                    )}
                  </div>
                  <p className="hero-description">
                    {emptyHome
                      ? t('emptyLibraryBody')
                      : game.slug === 'midnight-outlaws' && view !== 'game'
                        ? t('midnightSubtitle')
                        : description}
                  </p>
                  {emptyHome ? (
                    <Link className="button primary" href="/discover">
                      <Compass size={19} />
                      {t('explore')}
                      <ArrowRight size={17} />
                    </Link>
                  ) : (
                    actions(game, owned)
                  )}
                  <div className="hero-footnote">
                    {owned ? (
                      <>
                        <Clock3 size={13} />
                        {owned.lastPlayedAt
                          ? `${t('lastPlayed')}: ${formatDate(owned.lastPlayedAt, ui.language)}`
                          : t('neverPlayed')}
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={14} />
                        {t('localOnly')}
                      </>
                    )}
                  </div>
                </motion.div>
                <div className="hero-art-caption">
                  <span>NEXUS</span>
                  <small>{t('originalArt')}</small>
                </div>
                <div className="hero-index">
                  <span>
                    {String(
                      Math.max(1, data.games.findIndex((g) => g.id === game.id) + 1),
                    ).padStart(2, '0')}
                  </span>
                  <i /> {String(data.games.length).padStart(2, '0')}
                </div>
              </section>
            </>
          )}
          {view === 'home' && game && (
            <ConsoleStage
              data={data}
              game={game}
              entry={owned}
              language={ui.language}
              reduced={ui.reducedMotion}
              background={ui.background}
              actions={actions(game, owned)}
              renderCard={card}
              launch={launch}
            />
          )}
          {(view === 'library' || view === 'discover') && (
            <>
              {view === 'library' ? (
                <div className="page-heading">
                  <span className="eyebrow">{t('personalCollection')}</span>
                  <h1>
                    {t('library')}
                    <span className="count-badge">{data.library.length}</span>
                  </h1>
                  <p>{t('yourSpace')}</p>
                </div>
              ) : (
                <SectionHeading
                  title={t('allGames')}
                  label={`${t('available')}: ${data.games.filter(isPlayable).length} · ${t('comingSoon')}: ${data.games.filter((g) => g.status === 'COMING_SOON').length}`}
                />
              )}
              {(view === 'discover' || data.library.length > 0) && (
                <div className="filter-bar">
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      aria-label={t('search')}
                      placeholder={t('search')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button onClick={() => setQuery('')} aria-label={t('close')}>
                        <X size={16} />
                      </button>
                    )}
                  </label>
                  <div className="genre-tabs">
                    {['all', 'racing', 'shooter', 'adventure', 'exploration', 'puzzle'].map((g) => (
                      <button
                        className={genre === g ? 'selected' : ''}
                        key={g}
                        onClick={() => setGenre(g)}
                      >
                        {t(g === 'all' ? 'allGenres' : (g as TextKey))}
                      </button>
                    ))}
                  </div>
                  {view === 'library' && (
                    <>
                      <button
                        className={`icon-button ${favorites ? 'is-favorite' : ''}`}
                        aria-label={t('favoritesOnly')}
                        aria-pressed={favorites}
                        onClick={() => setFavorites(!favorites)}
                      >
                        <Heart size={19} />
                      </button>
                      <label className="sort-select">
                        <ArrowDownUp size={16} />
                        <select
                          aria-label={t('sortAdded')}
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="added">{t('sortAdded')}</option>
                          <option value="title">{t('sortTitle')}</option>
                          <option value="played">{t('sortPlayed')}</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}
              {view === 'library' ? (
                data.library.length === 0 ? (
                  <EmptyLibrary t={t} />
                ) : entries.length ? (
                  <div className="game-grid library-grid">
                    {entries.map((e) => (
                      <div key={e.id} className="library-entry">
                        {card(e.game, e)}
                        <div className="library-entry-actions">
                          <button
                            className="small-button"
                            disabled={!isPlayable(e.game)}
                            onClick={() => launch(e.game)}
                          >
                            <Play size={13} />
                            {t(isPlayable(e.game) ? 'play' : 'unavailable')}
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => libraryAction(e.game, 'remove')}
                            aria-label={t('remove')}
                            disabled={busy === e.gameId}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyResults t={t} />
                )
              ) : searchResults.filter((g) => genre === 'all' || g.genre === genre).length ? (
                <div className="game-grid">
                  {searchResults
                    .filter((g) => genre === 'all' || g.genre === genre)
                    .map((g) => (
                      <div key={g.id}>
                        {card(
                          g,
                          data.library.find((e) => e.gameId === g.id),
                        )}
                        <div className="catalog-card-action">
                          {isPlayable(g) ? (
                            data.library.some((e) => e.gameId === g.id) ? (
                              <button className="small-button" onClick={() => launch(g)}>
                                <Play size={13} />
                                {t('play')}
                              </button>
                            ) : (
                              <button
                                className="small-button"
                                disabled={busy === g.id}
                                onClick={() => libraryAction(g, 'add')}
                              >
                                <Plus size={15} />
                                {t('add')}
                              </button>
                            )
                          ) : (
                            <span>
                              <Clock3 size={13} />
                              {t('comingSoon')}
                            </span>
                          )}
                          <Link
                            href={`/games/${g.slug}`}
                            aria-label={`${t('details')}: ${g.title}`}
                          >
                            <ArrowUpRight />
                          </Link>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyResults t={t} />
              )}
            </>
          )}
          {view === 'game' && game && (
            <div className="detail-layout">
              <div>
                <span className="eyebrow">{t('behindGame')}</span>
                <h2>{t('about')}</h2>
                <p className="detail-description">{description}</p>
                {game.runtimeKey === 'nfs-underground' ? (
                  <div className="concept-notice">
                    <div>
                      <h3>Experimental Integration · Stage A</h3>
                      <p>
                        Оригинальный порт nfsu1-web. Требуется собственная SPEED.EXE 1.4 и локальная
                        утилита подготовки WASM. NEXUS не распространяет оригинальные игровые файлы.
                      </p>
                      <p>
                        WebGPU · WebAssembly threads · OPFS. Совместимость конкретной копии, игровых
                        режимов и физических контроллеров проверяется отдельно. Сетевые гонки не
                        подключены.
                      </p>
                      <p>
                        Сохранения и резервные копии остаются на устройстве; облачная передача
                        игровых сохранений выключена.
                      </p>
                      <a
                        href="https://github.com/lguilherme44/nfsu1-web"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Исходный проект ↗
                      </a>
                    </div>
                  </div>
                ) : isPlayable(game) ? (
                  <>
                    <h3>{t('features')}</h3>
                    <ul className="feature-list">
                      {(['feature1', 'feature2', 'feature3'] as TextKey[]).map((key) => (
                        <li key={key}>
                          <Check size={16} />
                          {t(key)}
                        </li>
                      ))}
                    </ul>
                    {game.screenshots?.length > 0 && (
                      <div className="screenshots">
                        <h3>{t('screenshots')}</h3>
                        {game.screenshots.map((src) => (
                          <img key={src} src={src} alt={t('screenshots')} />
                        ))}
                      </div>
                    )}
                    <h3>{t('controls')}</h3>
                    <div className="controls-info">
                      <div>
                        <span>
                          <Monitor size={18} />
                          {t('keyboard')}
                        </span>
                        <p>{t('controlsKeyboard')}</p>
                      </div>
                      <div>
                        <span>
                          <Gamepad2 size={18} />
                          {t('gamepad')}
                        </span>
                        <p>
                          <GameControlsHint fallback={t('controlsGamepad')} />
                        </p>
                      </div>
                      <div>
                        <span>{t('touch')}</span>
                        <p>{t('controlsTouch')}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="concept-notice">
                    <Clock3 size={20} />
                    <p>{t('conceptNotice')}</p>
                  </div>
                )}
              </div>
              <aside className="game-info-panel">
                <h3>{t('details')}</h3>
                <dl>
                  <div>
                    <dt>{t('genre')}</dt>
                    <dd>{t(game.genre as TextKey)}</dd>
                  </div>
                  <div>
                    <dt>{t('status')}</dt>
                    <dd>
                      <span className={isPlayable(game) ? 'green-text' : ''}>
                        {t(isPlayable(game) ? 'available' : 'comingSoon')}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('gameVersion')}</dt>
                    <dd>{game.version}</dd>
                  </div>
                  <div>
                    <dt>{game.runtimeKey === 'nfs-underground' ? 'Год выпуска' : t('bestLap')}</dt>
                    <dd>
                      {game.runtimeKey === 'nfs-underground' ? (
                        '2003'
                      ) : (
                        <>
                          {(
                            data.saves.find(
                              (s) =>
                                s.gameId === game.id && s.saveKey === 'best-lap:downtown-circuit',
                            ) ?? data.saves.find((s) => s.gameId === game.id)
                          )?.saveData.seconds?.toFixed(2) ?? '—'}{' '}
                          s
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
                <h4>{t('requirements')}</h4>
                <p>
                  {game.runtimeKey === 'nfs-underground'
                    ? 'Desktop · Chrome 140+ · WebGPU · SharedArrayBuffer · локальный комплект SPEED.EXE 1.4. Нужны свободное место в OPFS и память для исходного WASM (по умолчанию от 1 ГБ).'
                    : isPlayable(game)
                      ? t('requirementsBody')
                      : t('conceptNotice')}
                </p>
                {owned && (
                  <button className="danger-link" onClick={() => libraryAction(game, 'remove')}>
                    <Trash2 size={15} />
                    {t('remove')}
                  </button>
                )}
              </aside>
            </div>
          )}
          {view === 'controllers' && <ControllerSettings />}
          {view === 'friends' && data.user && (
            <SocialHub
              language={ui.language}
              userId={data.user.id}
              games={data.games}
              ownedIds={data.library.map((e) => e.gameId)}
            />
          )}
          {view === 'profile' && data.user && (
            <ProfilePanel
              data={data}
              onSaved={async () => {
                await refresh();
                setToast(t('saved'));
              }}
              onError={setError}
            />
          )}
          {view === 'admin' && (
            <AdminPanel
              language={ui.language}
              onError={setError}
              onSaved={() => setToast(t('adminSaved'))}
            />
          )}
        </main>
        {contextGame &&
          (() => {
            const target =
              data.games.find((g) => g.id === contextGame) ??
              data.library.find((e) => e.gameId === contextGame)?.game;
            if (!target) return null;
            const entry = data.library.find((e) => e.gameId === contextGame);
            return (
              <Modal
                title={target.title}
                closeLabel={t('close')}
                onClose={() => setContextGame(null)}
              >
                <div className="game-context-actions">
                  {entry && isPlayable(target) && (
                    <button
                      className="button primary"
                      onClick={() => {
                        setContextGame(null);
                        launch(target);
                      }}
                    >
                      {t('playNow')}
                    </button>
                  )}
                  <Link
                    className="button secondary"
                    href={`/games/${target.slug}`}
                    onClick={() => setContextGame(null)}
                  >
                    {t('details')}
                  </Link>
                  {isPlayable(target) && (
                    <button
                      className="button secondary"
                      disabled={busy === target.id}
                      onClick={async () => {
                        await libraryAction(target, entry ? 'favorite' : 'add');
                        setContextGame(null);
                      }}
                    >
                      {t(entry ? 'favorite' : 'add')}
                    </button>
                  )}
                  {entry && (
                    <button
                      className="button secondary"
                      disabled={busy === target.id}
                      onClick={async () => {
                        await libraryAction(target, 'remove');
                        setContextGame(null);
                      }}
                    >
                      {t('remove')}
                    </button>
                  )}
                </div>
              </Modal>
            );
          })()}
        <footer className="console-footer">
          <span>
            <i className="live-dot" />
            {t('online')}
          </span>
          <p>{t('footer')}</p>
          <div className="input-hints">
            <span>
              <kbd>← →</kbd>
              {t('keyboardHint')}
            </span>
            <span>
              <InputGlyph action="confirm" fallback="↵" />
              {t('enterHint')}
            </span>
            <time>{clock}</time>
          </div>
        </footer>
        <AnimatePresence>
          {toast && (
            <motion.div
              className="toast"
              role="status"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
            >
              <span>
                <Check size={17} />
              </span>
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
        {data.user && <SocialPresence language={ui.language} userId={data.user.id} />}
        {dialog === 'notifications' && data.user && (
          <FriendsDrawer
            language={ui.language}
            userId={data.user.id}
            games={data.games}
            ownedIds={data.library.map((e) => e.gameId)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'notifications' && !data.user && (
          <Modal title={t('notifications')} closeLabel={t('close')} onClose={() => setDialog(null)}>
            <div className="notification-empty">
              <Bell size={34} />
              <h3>{t('noNotifications')}</h3>
              <p>{t('notificationHint')}</p>
            </div>
          </Modal>
        )}
        {dialog === 'search' && (
          <Modal title={t('search')} closeLabel={t('close')} onClose={() => setDialog(null)}>
            <label className="search-field modal-search">
              <Search size={20} />
              <input
                autoFocus
                placeholder={t('searchHint')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="search-results">
              {searchResults.map((g) => (
                <Link key={g.id} href={`/games/${g.slug}`} onClick={() => setDialog(null)}>
                  <img src={g.cover} alt="" />
                  <div>
                    <strong>{g.title}</strong>
                    <span>
                      {t(g.genre as TextKey)} · {t(isPlayable(g) ? 'available' : 'comingSoon')}
                    </span>
                  </div>
                  <ArrowRight size={18} />
                </Link>
              ))}
              {!searchResults.length && <EmptyResults t={t} />}
            </div>
          </Modal>
        )}
      </div>
    </MotionConfig>
  );
}
function ArrowUpRight() {
  return <ArrowRight size={17} style={{ transform: 'rotate(-35deg)' }} />;
}
function SectionHeading({
  title,
  label,
  href,
  linkLabel,
  count,
}: {
  title: string;
  label?: string;
  href?: string;
  linkLabel?: string;
  count?: number;
}) {
  return (
    <div className="section-heading">
      <div>
        {label && <span className="eyebrow muted">{label}</span>}
        <h2>
          {title}
          {count !== undefined && (
            <span className="count-badge">{String(count).padStart(2, '0')}</span>
          )}
        </h2>
      </div>
      {href && (
        <Link href={href} className="text-link">
          {linkLabel}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
function EmptyLibrary({ t }: { t: (key: TextKey) => string }) {
  return (
    <div className="empty-library">
      <div className="empty-orbit">
        <Library size={32} />
        <i />
        <i />
      </div>
      <span className="eyebrow">{t('nextChapter')}</span>
      <h2>{t('emptyLibrary')}</h2>
      <p>{t('emptyLibraryBody')}</p>
      <Link href="/discover" className="button secondary">
        <Compass size={18} />
        {t('explore')}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
function EmptyResults({ t }: { t: (key: TextKey) => string }) {
  return (
    <div className="empty-results">
      <Search size={28} />
      <h3>{t('noResults')}</h3>
      <p>{t('noResultsBody')}</p>
    </div>
  );
}
function GameCard({
  game,
  entry,
  selected,
  onSelect,
  onFavorite,
  language,
  busy,
}: {
  game: GameDTO;
  entry?: LibraryDTO;
  selected?: boolean;
  onSelect?: () => void;
  onFavorite: () => void;
  language: 'ru' | 'en';
  busy: boolean;
}) {
  const t = (key: TextKey) => dictionary[language][key];
  const content = (
    <>
      <img src={game.cover} alt="" loading="lazy" />
      <div className="cover-shade" />
      <div className="cover-top">
        {entry && (
          <span className="owned-indicator">
            <Check size={13} />
          </span>
        )}
      </div>
      <div className={`cover-title cover-${game.slug}`}>
        <span>{game.title.split(' ').slice(0, -1).join(' ')}</span>
        <strong>{game.title.split(' ').slice(-1)}</strong>
        <small>{game.status === 'AVAILABLE' ? 'AFTER HOURS' : t('comingSoon')}</small>
      </div>
      {selected && (
        <span className="selected-pill">
          <span />
          {t('featured')}
        </span>
      )}
      <span className="cover-open">
        <ArrowUpRight />
      </span>
    </>
  );
  return (
    <motion.article
      animate={{ scale: selected ? 1.012 : 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      data-game-id={game.id}
      className={`game-card art-${game.slug} ${selected ? 'selected-card' : ''}`}
    >
      {onSelect ? (
        <button
          className="game-cover"
          data-focus-key={`game-${game.id}`}
          onFocus={onSelect}
          onClick={onSelect}
          aria-label={game.title}
          aria-pressed={selected}
        >
          {content}
        </button>
      ) : (
        <Link
          href={`/games/${game.slug}`}
          className="game-cover"
          data-focus-key={`game-${game.id}`}
          onClick={() => rememberReturn(location.pathname, game.id)}
          aria-label={game.title}
        >
          {content}
        </Link>
      )}
      <div className="game-card-meta">
        <div>
          <Link href={`/games/${game.slug}`}>
            <h3>{game.title}</h3>
          </Link>
          <p>
            {t(game.genre as TextKey)}
            <span>·</span>
            {game.runtimeKey === 'nfs-underground'
              ? '2003 · Experimental · Own files'
              : t(
                  isPlayable(game)
                    ? 'free'
                    : game.published && game.status === 'COMING_SOON'
                      ? 'comingSoon'
                      : 'unavailable',
                )}
          </p>
        </div>
        {entry ? (
          <button
            className={`icon-button ${entry.isFavorite ? 'is-favorite' : ''}`}
            disabled={busy}
            onClick={onFavorite}
            aria-label={t(entry.isFavorite ? 'unfavorite' : 'favorite')}
          >
            <Heart size={17} fill={entry.isFavorite ? 'currentColor' : 'none'} />
          </button>
        ) : isPlayable(game) ? (
          <span className="available-dot" aria-label={t('available')} />
        ) : (
          <Clock3 size={15} className="muted" />
        )}
      </div>
    </motion.article>
  );
}
function ProfilePanel({
  data,
  onSaved,
  onError,
}: {
  data: ConsoleData;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const user = data.user!;
  const ui = useUI();
  const t = (key: TextKey) => dictionary[ui.language][key];
  const [settings, setSettings] = useState<SettingsDTO>(
    user.settings ?? {
      language: ui.language,
      uiSoundEnabled: false,
      reducedMotion: false,
      backgroundEffectsEnabled: true,
      profilePrivate: true,
    },
  );
  const [avatar, setAvatar] = useState(user.avatar);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [busy, startSaving] = useTransition();
  function save() {
    startSaving(async () => {
      try {
        const result = await updatePreferencesAction({ ...settings, avatar });
        if (!result.ok) throw new Error(result.error);
        ui.setPreferences({
          language: settings.language,
          sound: settings.uiSoundEnabled,
          reducedMotion: settings.reducedMotion,
          background: settings.backgroundEffectsEnabled,
        });
        await onSaved();
      } catch (e) {
        onError(translate(ui.language, e instanceof Error ? e.message : 'serverError'));
      }
    });
  }
  return (
    <>
      <Link
        className="button secondary controller-profile-link"
        data-controller-settings
        href="/controllers"
      >
        <Gamepad2 size={18} />
        {inputText(ui.language, 'controllerSettings')}
      </Link>
      <div className="profile-hero">
        <div className={`avatar big-avatar avatar-${avatar}`}>{user.username[0].toUpperCase()}</div>
        <div>
          <span className="eyebrow">{t('personalSpace')}</span>
          <h1>{user.username}</h1>
          <p>
            {t('playerSince')} {formatDate(user.createdAt, ui.language)}
          </p>
        </div>
        <button
          className="button secondary signout-button"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          <LogOut size={17} />
          {t('signOut')}
        </button>
      </div>
      <div className="stats-grid">
        <div>
          <Library size={22} />
          <strong>{data.library.length}</strong>
          <span>{t('gameCount')}</span>
        </div>
        <div>
          <Clock3 size={22} />
          <strong>
            {user.totalSeconds < 3600
              ? `${Math.floor(user.totalSeconds / 60)} ${t('minutes')}`
              : `${(user.totalSeconds / 3600).toFixed(1)} ${t('hours')}`}
          </strong>
          <span>{t('totalTime')}</span>
        </div>
        <div>
          <Gamepad2 size={22} />
          <strong className="last-game-title">{user.lastGame?.title ?? '—'}</strong>
          <span>{user.lastGame ? t('lastPlayed') : t('noLastGame')}</span>
        </div>
      </div>
      <div className="profile-layout">
        <section className="settings-panel" id="settings">
          <div className="section-heading">
            <h2>
              <Settings2 size={22} />
              {t('settings')}
            </h2>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('language')}</strong>
            </div>
            <select
              disabled={!interactive || busy}
              aria-label={t('language')}
              value={settings.language}
              onChange={(e) =>
                setSettings({ ...settings, language: e.target.value as 'ru' | 'en' })
              }
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
          {(
            [
              { key: 'uiSoundEnabled', title: 'sound', hint: 'soundHint' },
              { key: 'reducedMotion', title: 'motion', hint: 'motionHint' },
              { key: 'backgroundEffectsEnabled', title: 'background', hint: 'backgroundHint' },
              { key: 'profilePrivate', title: 'privacy', hint: 'privacyHint' },
            ] as const
          ).map((row) => (
            <div className="setting-row" key={row.key}>
              <div>
                <strong>{t(row.title)}</strong>
                <p>{t(row.hint)}</p>
              </div>
              <button
                disabled={!interactive || busy}
                role="switch"
                aria-checked={settings[row.key]}
                aria-label={t(row.title)}
                className={`toggle ${settings[row.key] ? 'on' : ''}`}
                onClick={() => {
                  setSettings({ ...settings, [row.key]: !settings[row.key] });
                  if (row.key === 'uiSoundEnabled' && !settings.uiSoundEnabled) {
                    ui.setPreferences({ sound: true });
                    playSound('confirm');
                  }
                }}
              >
                <span />
              </button>
            </div>
          ))}
          <div className="setting-row">
            <strong>{t('avatar')}</strong>
            <div className="avatar-options">
              {['violet', 'cyan', 'coral', 'mint'].map((color) => (
                <button
                  key={color}
                  disabled={!interactive || busy}
                  className={`avatar avatar-${color} ${avatar === color ? 'chosen-avatar' : ''}`}
                  onClick={() => setAvatar(color)}
                  aria-label={color}
                  aria-pressed={avatar === color}
                >
                  {avatar === color ? <Check size={17} /> : ''}
                </button>
              ))}
            </div>
          </div>
          <button className="button primary" onClick={save} disabled={!interactive || busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{' '}
            {t(busy ? 'saving' : 'saveSettings')}
          </button>
        </section>
        <aside className="profile-aside">
          <span className="eyebrow">PERSONAL BEST</span>
          <h2>{t('bestLap')}</h2>
          {data.saves.length ? (
            data.saves.map((save) => (
              <div className="best-lap-card" key={save.gameId + save.saveKey}>
                <Gamepad2 />
                <h3>{data.games.find((g) => g.id === save.gameId)?.title ?? 'MIDNIGHT OUTLAWS'}</h3>
                <small>
                  {cityRoutes.find((r) => save.saveKey === `best-lap:${r.id}`)?.[
                    ui.language === 'ru' ? 'nameRu' : 'name'
                  ] ?? (ui.language === 'ru' ? 'Прежняя трасса' : 'Original circuit')}
                </small>
                <strong>
                  {save.saveData.seconds.toFixed(2)}
                  <small> s</small>
                </strong>
              </div>
            ))
          ) : (
            <div className="no-record">
              <Clock3 size={30} />
              <p>{t('noRecord')}</p>
            </div>
          )}
          {user.role === 'ADMIN' && (
            <Link href="/admin" className="button secondary">
              <ShieldCheck size={17} />
              {t('admin')}
              <ChevronRight size={16} />
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}
