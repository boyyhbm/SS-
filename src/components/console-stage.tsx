'use client';
import Link from 'next/link';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { ArrowUpRight, Compass, Users, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConsoleData, GameDTO, LibraryDTO } from '@/lib/data';
import { dictionary, type TextKey } from '@/lib/i18n';
import { isPlayable } from '@/games/registry';
import { visualText } from '@/games/visual/i18n';
export function ConsoleStage({
  data,
  game,
  entry,
  language,
  reduced,
  background,
  actions,
  renderCard,
  launch,
}: {
  data: ConsoleData;
  game: GameDTO;
  entry?: LibraryDTO;
  language: 'ru' | 'en';
  reduced: boolean;
  background: boolean;
  actions: ReactNode;
  renderCard: (g: GameDTO, e?: LibraryDTO, selectable?: boolean) => ReactNode;
  launch: (g: GameDTO) => void;
}) {
  const t = (key: TextKey) => dictionary[language][key],
    empty = !!data.user && !data.library.length;
  const pointerX = useMotionValue(0),
    pointerY = useMotionValue(0),
    x = useTransform(pointerX, [-1, 1], ['-0.6%', '0.6%']),
    y = useTransform(pointerY, [-1, 1], ['-0.4%', '0.4%']),
    systemReduced = useReducedMotion();
  const recent = [...data.library]
    .filter((e) => e.lastPlayedAt && isPlayable(e.game))
    .sort((a, b) => new Date(b.lastPlayedAt!).getTime() - new Date(a.lastPlayedAt!).getTime());
  return (
    <>
      <section
        className={`console-stage ${empty ? 'stage-empty-library' : ''}`}
        aria-label={game.title}
        onPointerMove={(e) => {
          if (reduced || systemReduced || !background) return;
          const r = e.currentTarget.getBoundingClientRect();
          pointerX.set(((e.clientX - r.left) / r.width) * 2 - 1);
          pointerY.set(((e.clientY - r.top) / r.height) * 2 - 1);
        }}
      >
        <div className={`stage-wallpaper wallpaper-${game.slug}`}>
          <AnimatePresence mode="sync">
            <motion.img
              key={game.id}
              src={game.banner}
              alt=""
              style={reduced || systemReduced ? {} : { x, y }}
              initial={{ opacity: 0, scale: 1.045 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.48, ease: [0.2, 0.65, 0.2, 1] }}
            />
          </AnimatePresence>
        </div>
        <div className="stage-atmosphere" />
        <div className="stage-library">
          <div className="stage-library-label">
            <h2>{data.user ? t('yourCollection') : t('curated')}</h2>
            {data.user && <span>{String(data.library.length).padStart(2, '0')}</span>}
          </div>
          {!empty ? (
            <div
              className="stage-game-rail game-carousel"
              aria-label={data.user ? t('yourCollection') : t('curated')}
            >
              {data.user
                ? data.library.map((e) => renderCard(e.game, e, true))
                : data.games.map((g) => renderCard(g, undefined, true))}
              <Link className="stage-discover-tile" href="/discover" aria-label={t('explore')}>
                <Compass size={30} />
                <span>{t('discover')}</span>
              </Link>
            </div>
          ) : (
            <Link href="/discover" className="stage-empty-tile">
              <Compass size={30} />
              <span>{t('discover')}</span>
              <ArrowUpRight size={24} />
            </Link>
          )}
        </div>
        <motion.div
          className="stage-game-dossier"
          key={`${game.id}-${empty}`}
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <span className="stage-game-kind">
            {empty
              ? t('welcome')
              : isPlayable(game)
                ? `${t(game.genre as TextKey)} / ${visualText(language, 'afterHours')}`
                : t('comingSoon')}
          </span>
          <h1>
            {empty ? (
              t('emptyLibrary')
            ) : game.slug === 'midnight-outlaws' ? (
              <>
                MIDNIGHT
                <br />
                <em>OUTLAWS</em>
              </>
            ) : (
              game.title
            )}
          </h1>
          <p>
            {empty
              ? t('emptyLibraryBody')
              : game.slug === 'midnight-outlaws'
                ? visualText(language, 'nightTagline')
                : language === 'ru'
                  ? game.description
                  : game.descriptionEn}
          </p>
          {empty ? (
            <Link className="button primary" href="/discover">
              <Compass size={18} />
              {t('explore')}
              <ArrowUpRight size={18} />
            </Link>
          ) : (
            actions
          )}
          {entry && (
            <span className="stage-game-history">
              {entry.lastPlayedAt
                ? `${t('lastPlayed')} · ${new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(new Date(entry.lastPlayedAt))}`
                : t('neverPlayed')}
            </span>
          )}
        </motion.div>
        <div className="stage-side-label">
          {game.slug === 'midnight-outlaws' ? 'MIDNIGHT DISTRICT' : game.title} <span>01</span>
        </div>
        <div className="stage-bottom-dock">
          <span className="stage-system-status">
            <i />
            {visualText(language, 'spaceToPlay')}
          </span>
          <Link href={data.user ? '/friends' : '/login'}>
            <Users size={18} />
            {visualText(language, 'playTogether')}
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </section>
      {data.user && data.library.length > 0 && (
        <section className="console-activity">
          {recent.length > 0 && (
            <div>
              <h2>{t('continuePlaying')}</h2>
              <div className="activity-games">
                {recent.slice(0, 3).map((e) => (
                  <button key={e.id} onClick={() => launch(e.game)}>
                    <img src={e.game.cover} alt="" />
                    <span>
                      {e.game.title}
                      <small>
                        {new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(
                          new Date(e.lastPlayedAt!),
                        )}
                      </small>
                    </span>
                    <Play size={19} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <h2>{t('recentlyAdded')}</h2>
            <div className="activity-games">
              {[...data.library]
                .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
                .slice(0, 3)
                .map((e) => (
                  <Link href={`/games/${e.game.slug}`} key={e.id}>
                    <img src={e.game.cover} alt="" />
                    <span>
                      {e.game.title}
                      <small>
                        {new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(
                          new Date(e.addedAt),
                        )}
                      </small>
                    </span>
                    <ArrowUpRight size={18} />
                  </Link>
                ))}
            </div>
          </div>
          <Link className="activity-discover" href="/discover">
            <Compass size={24} />
            <span>
              {t('discoverGames')}
              <small>{t('discoverSubtitle')}</small>
            </span>
            <ArrowUpRight size={22} />
          </Link>
        </section>
      )}
    </>
  );
}
