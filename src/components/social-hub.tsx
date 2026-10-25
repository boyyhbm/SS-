'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Crown,
  Flag,
  Gamepad2,
  Plus,
  Search,
  Shield,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { multiplayerText as text, multiplayerError } from '@/multiplayer/i18n';
import type { Person, SocialData } from '@/multiplayer/social-types';
import type { Language } from '@/lib/i18n';
import type { GameDTO } from '@/lib/data';
import { timeLabel } from '@/games/racing-physics';
import { Modal } from './modal';
function useSocial() {
  const [data, setData] = useState<SocialData | null>(null);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const res = await fetch('/api/social', { cache: 'no-store' });
      if (!res.ok) throw new Error('networkUnavailable');
      const next = await res.json();
      if (sequence === requestSequence.current) {
        setData(next);
        setError('');
      }
    } catch {
      setError('networkUnavailable');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const updatePrivacy = (privacy: SocialData['privacy']) => {
    requestSequence.current++;
    setData((previous) => (previous ? { ...previous, privacy } : previous));
  };
  return { data, error, refresh, updatePrivacy };
}
export function SocialPresence({ language, userId }: { language: Language; userId: string }) {
  const [notice, setNotice] = useState('');
  const previous = useRef<SocialData | null>(null);
  useEffect(() => {
    let activity = true,
      disposed = false;
    const active = () => {
      activity = true;
    };
    const update = async () => {
      if (document.hidden) return;
      try {
        await fetch('/api/multiplayer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'heartbeat', activity }),
        });
        activity = false;
        const res = await fetch('/api/social', { cache: 'no-store' });
        if (!res.ok || disposed) return;
        const next: SocialData = await res.json();
        if (previous.current) {
          const fresh = next.invites.find(
            (i) => !previous.current!.invites.some((old) => old.id === i.id),
          );
          const friend = next.friends.find(
            (f) =>
              previous.current!.network?.friends[f.id]?.status === 'offline' &&
              next.network?.friends[f.id]?.status !== 'offline',
          );
          if (fresh)
            setNotice(
              `${fresh.sender.username} · ${text(language, fresh.kind === 'PARTY' ? 'partyInvite' : 'gameInvite')}`,
            );
          else if (friend) setNotice(`${friend.username} · ${text(language, 'friendOnline')}`);
        }
        previous.current = next;
      } catch {
        /* The friends screen shows server downtime; no fake presence is emitted. */
      }
    };
    window.addEventListener('pointerdown', active);
    window.addEventListener('keydown', active);
    void update();
    const timer = setInterval(update, 15000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', active);
      previous.current = null;
    };
  }, [language, userId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice ? (
    <Link href="/friends" role="status" className="social-notice">
      <Users size={18} />
      {notice}
      <ArrowUpRight size={16} />
    </Link>
  ) : null;
}
export function SocialHub({
  language,
  userId,
  games,
  ownedIds,
  compact = false,
}: {
  language: Language;
  userId: string;
  games: GameDTO[];
  ownedIds: string[];
  compact?: boolean;
}) {
  const { data, error, refresh, updatePrivacy } = useSocial();
  const t = (key: Parameters<typeof text>[1]) => text(language, key);
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Person[] | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const game = games.find((g) => g.runtimeKey === 'midnight-outlaws' && ownedIds.includes(g.id));
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const response = await res.json();
      if (!res.ok) throw new Error(response.error);
      await refresh();
      setNotice(
        t(
          body.action === 'request'
            ? 'sent'
            : body.action === 'partyInvite' || body.action === 'gameInvite'
              ? 'inviteSent'
              : 'saved',
        ),
      );
    } catch (e) {
      setNotice(multiplayerError(language, e instanceof Error ? e.message : 'error'));
    } finally {
      setBusy(false);
    }
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/social?q=${encodeURIComponent(query)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setResults(body.users);
    } catch {
      setNotice(t('error'));
    } finally {
      setBusy(false);
    }
  }
  function avatar(person: Person, status = 'offline') {
    return (
      <span className={`avatar avatar-${person.avatar} social-avatar`}>
        {person.username[0].toUpperCase()}
        <i className={`presence-dot presence-${status}`} />
      </span>
    );
  }
  return (
    <div className={`social-hub ${compact ? 'social-compact' : ''}`}>
      {!compact && (
        <div className="social-heading">
          <span className="eyebrow">NEXUS / TOGETHER</span>
          <h1>{t('social')}</h1>
          <p>{t('socialBody')}</p>
        </div>
      )}
      {(notice || error) && (
        <p className="social-feedback" role="status">
          {notice || multiplayerError(language, error)}
        </p>
      )}
      <form className="people-search" onSubmit={search}>
        <Search size={18} />
        <input
          aria-label={t('searchPeople')}
          placeholder={t('searchPeople')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          minLength={3}
          maxLength={24}
          required
        />
        <button className="button secondary" disabled={busy}>
          {t('find')}
        </button>
      </form>
      {results && (
        <div className="people-results">
          {results.length ? (
            results.map((p) => (
              <div className="person-row" key={p.id}>
                {avatar(p)}
                <strong>{p.username}</strong>
                <button
                  disabled={
                    busy ||
                    data?.friends.some((f) => f.id === p.id) ||
                    data?.outgoing.some((r) => r.recipientId === p.id)
                  }
                  className="button small secondary"
                  onClick={() => action({ action: 'request', username: p.username })}
                >
                  <UserPlus size={16} />
                  {t('addFriend')}
                </button>
                <button
                  className="icon-button"
                  aria-label={t('block')}
                  onClick={() => action({ action: 'block', userId: p.id })}
                >
                  <Shield size={15} />
                </button>
              </div>
            ))
          ) : (
            <p className="muted">{t('emptySearch')}</p>
          )}
        </div>
      )}
      {!data ? (
        <div className="social-skeleton" aria-label={t('loading')} />
      ) : (
        <>
          {!!data.incoming.length && (
            <section className="social-section">
              <h2>
                {t('incoming')}
                <span>{data.incoming.length}</span>
              </h2>
              {data.incoming.map((r) => (
                <div className="person-row" key={r.id}>
                  {avatar(r.sender)}
                  <strong>{r.sender.username}</strong>
                  <button
                    disabled={busy}
                    className="button small primary"
                    onClick={() => action({ action: 'accept', id: r.id })}
                  >
                    <Check size={15} />
                    {t('accept')}
                  </button>
                  <button
                    disabled={busy}
                    className="icon-button"
                    aria-label={t('decline')}
                    onClick={() => action({ action: 'decline', id: r.id })}
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </section>
          )}
          <section className="social-section">
            <h2>
              {t('invites')}
              <span>{data.invites.length}</span>
            </h2>
            {!data.invites.length ? (
              <p className="muted social-empty-line">{t('noInvites')}</p>
            ) : (
              <div className="invite-grid">
                {data.invites.map((invite) => (
                  <motion.article
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="invite-card"
                    key={invite.id}
                  >
                    <span className="invite-icon">
                      {invite.kind === 'PARTY' ? <Users /> : <Flag />}
                    </span>
                    <div>
                      <span className="eyebrow">
                        {t(invite.kind === 'PARTY' ? 'partyInvite' : 'gameInvite')}
                      </span>
                      <h3>{invite.sender.username}</h3>
                      <p>{invite.game?.title ?? 'NEXUS PARTY'}</p>
                    </div>
                    <div className="invite-actions">
                      {invite.kind === 'PARTY' ? (
                        <button
                          className="button small primary"
                          disabled={busy}
                          onClick={() => action({ action: 'partyAccept', id: invite.id })}
                        >
                          {t('accept')}
                        </button>
                      ) : invite.game && ownedIds.includes(invite.game.id) ? (
                        <Link
                          className="button small primary"
                          href={`/online/${invite.game.slug}?room=${invite.roomId}`}
                        >
                          {t('join')}
                        </Link>
                      ) : (
                        <p className="muted">{t('needsGame')}</p>
                      )}
                      <button
                        className="icon-button"
                        aria-label={t('decline')}
                        disabled={busy}
                        onClick={() => action({ action: 'inviteDecline', id: invite.id })}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </motion.article>
                ))}
              </div>
            )}
          </section>
          <div className="social-columns">
            <section className="social-section friends-section">
              <h2>
                {t('friends')}
                <span>
                  {
                    data.friends.filter(
                      (f) =>
                        data.network?.friends[f.id]?.status &&
                        data.network.friends[f.id].status !== 'offline',
                    ).length
                  }{' '}
                  {t('onlineCount')}
                </span>
              </h2>
              {!data.friends.length ? (
                <div className="social-empty">
                  <Users size={35} />
                  <h3>{t('noFriends')}</h3>
                  <p>{t('noFriendsBody')}</p>
                </div>
              ) : (
                <div className="friends-grid">
                  {data.friends.map((friend) => {
                    const presence = data.network?.friends[friend.id] ?? {
                      status: 'offline' as const,
                    };
                    const targetGame = games.find((g) => g.id === presence.gameId);
                    return (
                      <article className="friend-card" key={friend.id}>
                        {avatar(friend, presence.status)}
                        <div className="friend-identity">
                          <h3>{friend.username}</h3>
                          <span className={`status-label status-${presence.status}`}>
                            {t(presence.status)}
                          </span>
                          {targetGame && <p>{targetGame.title}</p>}
                        </div>
                        <div className="friend-actions">
                          {presence.joinable &&
                            presence.roomId &&
                            targetGame &&
                            ownedIds.includes(targetGame.id) && (
                              <Link
                                className="button small primary"
                                href={`/online/${targetGame.slug}?room=${presence.roomId}`}
                              >
                                {t('joinFriend')}
                                <ArrowUpRight size={14} />
                              </Link>
                            )}
                          {data.party?.leaderId === userId &&
                            !data.party.members.some((m) => m.userId === friend.id) && (
                              <button
                                disabled={busy}
                                className="button small secondary"
                                onClick={() => action({ action: 'partyInvite', userId: friend.id })}
                              >
                                {t('inviteParty')}
                              </button>
                            )}
                          <button
                            disabled={busy}
                            className="text-button"
                            onClick={() => action({ action: 'remove', userId: friend.id })}
                          >
                            {t('removeFriend')}
                          </button>
                          <button
                            disabled={busy}
                            className="text-button"
                            onClick={() => action({ action: 'block', userId: friend.id })}
                          >
                            {t('block')}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="social-section party-section">
              <h2>
                {t('party')}
                <Users size={19} />
              </h2>
              {data.party ? (
                <>
                  <div className="party-members">
                    {data.party.members.map((member) => (
                      <div className="person-row" key={member.userId}>
                        {avatar(
                          member.user,
                          data.network?.friends[member.userId]?.status ??
                            (member.userId === userId ? 'online' : 'offline'),
                        )}
                        <strong>{member.user.username}</strong>
                        {member.userId === data.party!.leaderId ? (
                          <span className="leader-badge">
                            <Crown size={13} />
                            {t('leader')}
                          </span>
                        ) : (
                          data.party!.leaderId === userId && (
                            <button
                              disabled={busy}
                              className="icon-button"
                              aria-label={t('makeLeader')}
                              onClick={() =>
                                action({ action: 'partyLeader', userId: member.userId })
                              }
                            >
                              <Crown size={15} />
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                  {game && (
                    <Link className="button primary" href={`/online/${game.slug}?party=1`}>
                      <Gamepad2 size={17} />
                      {t('partySearch')}
                    </Link>
                  )}
                  <button
                    disabled={busy}
                    className="text-button"
                    onClick={() => action({ action: 'partyLeave' })}
                  >
                    {t('leaveParty')}
                  </button>
                </>
              ) : (
                <div className="party-empty">
                  <span className="party-orbit">
                    <Users size={30} />
                  </span>
                  <p>{t('noFriendsBody')}</p>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => action({ action: 'partyCreate' })}
                  >
                    <Plus size={16} />
                    {t('createParty')}
                  </button>
                </div>
              )}
            </section>
          </div>
          {!compact && (
            <>
              <section className="social-section match-history">
                <h2>{t('history')}</h2>
                {!data.history.length ? (
                  <p className="muted">{t('noHistory')}</p>
                ) : (
                  data.history.map((entry) => (
                    <div className="history-row" key={entry.id}>
                      <span className="history-place">
                        {entry.result?.place ? `#${entry.result.place}` : '—'}
                      </span>
                      <div>
                        <strong>{entry.match.game.title}</strong>
                        <p>
                          {new Intl.DateTimeFormat(language, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(entry.match.startedAt))}
                        </p>
                      </div>
                      <strong>
                        {entry.match.status === 'ABORTED'
                          ? t('aborted')
                          : entry.result?.didFinish
                            ? timeLabel(entry.result.timeSeconds!)
                            : entry.result
                              ? t('dnf')
                              : t('racing')}
                      </strong>
                      {entry.result?.serverVerified && (
                        <span className="verified-tag">
                          <Shield size={14} />
                          {t('verified')}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </section>
              <section className="social-section social-privacy">
                <h2>{t('privacy')}</h2>
                {(['hideActivity', 'friendsOnlyInvites', 'showGamePresence'] as const).map(
                  (key) => (
                    <label key={key}>
                      <span>{t(key)}</span>
                      <input
                        type="checkbox"
                        checked={data.privacy[key]}
                        disabled={busy}
                        onChange={(e) => {
                          const privacy = { ...data.privacy, [key]: e.target.checked };
                          updatePrivacy(privacy);
                          void action({ action: 'privacy', ...privacy });
                        }}
                      />
                    </label>
                  ),
                )}
              </section>
              {!!data.blocked.length && (
                <section className="social-section">
                  <h2>{t('blocked')}</h2>
                  {data.blocked.map((p) => (
                    <div className="person-row" key={p.id}>
                      {avatar(p)}
                      <strong>{p.username}</strong>
                      <button
                        className="button small secondary"
                        onClick={() => action({ action: 'unblock', userId: p.id })}
                      >
                        {t('unblock')}
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
export function FriendsDrawer({
  language,
  userId,
  games,
  ownedIds,
  onClose,
}: {
  language: Language;
  userId: string;
  games: GameDTO[];
  ownedIds: string[];
  onClose: () => void;
}) {
  return (
    <Modal title={text(language, 'friends')} onClose={onClose} closeLabel={text(language, 'back')}>
      <SocialHub language={language} userId={userId} games={games} ownedIds={ownedIds} compact />
    </Modal>
  );
}
export function SocialPeek({ language }: { language: Language }) {
  const { data } = useSocial();
  return (
    <section className="social-peek">
      <div>
        <span className="eyebrow">NEXUS / TOGETHER</span>
        <h2>{text(language, 'friends')}</h2>
      </div>
      <div className="peek-avatars">
        {data?.friends.slice(0, 5).map((friend) => (
          <Link
            key={friend.id}
            href="/friends"
            title={friend.username}
            className={`avatar avatar-${friend.avatar} social-avatar`}
          >
            {friend.username[0].toUpperCase()}
            <i
              className={`presence-dot presence-${data.network?.friends[friend.id]?.status ?? 'offline'}`}
            />
          </Link>
        ))}
      </div>
      <p>
        {data?.friends.length
          ? `${data.friends.filter((f) => data.network?.friends[f.id]?.status && data.network.friends[f.id].status !== 'offline').length} ${text(language, 'onlineCount')}`
          : text(language, 'noFriendsBody')}
      </p>
      <Link className="button secondary" href="/friends">
        <Users size={17} />
        {text(language, data?.friends.length ? 'friends' : 'addFriend')}
        <ArrowUpRight size={15} />
      </Link>
    </section>
  );
}
