'use client';
import { confirmWithController } from '@/input/focus';
import { useEffect, useState } from 'react';
import { Check, Edit3, LoaderCircle, Plus, Trash2, Upload, X } from 'lucide-react';
import type { GameDTO } from '@/lib/data';
import { dictionary, translate, type Language, type TextKey } from '@/lib/i18n';
const empty = {
  slug: '',
  title: '',
  description: '',
  descriptionEn: '',
  genre: 'racing',
  cover: '/art/midnight-cover.svg',
  banner: '/art/midnight-banner.svg',
  status: 'DRAFT',
  runtimeKey: '',
  sortOrder: 0,
  published: false,
};
type FormGame = typeof empty & { id?: string };
export function AdminPanel({
  language,
  onError,
  onSaved,
}: {
  language: Language;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const t = (key: TextKey) => dictionary[language][key];
  const [games, setGames] = useState<GameDTO[]>([]),
    [form, setForm] = useState<FormGame | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch('/api/admin/games');
    if (!response.ok) throw new Error('accessDenied');
    setGames(await response.json());
  }
  useEffect(() => {
    void load().catch(() => onError(t('serverError')));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await load();
      setForm(null);
      onSaved();
    } catch (e) {
      onError(translate(language, e instanceof Error ? e.message : 'serverError'));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!(await confirmWithController(t('deleteConfirm')))) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/games', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await load();
      setForm(null);
      onSaved();
    } catch (e) {
      onError(translate(language, e instanceof Error ? e.message : 'serverError'));
    } finally {
      setBusy(false);
    }
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>, target: 'cover' | 'banner') {
    const file = event.target.files?.[0];
    if (!file || !form) return;
    setBusy(true);
    try {
      const payload = new FormData();
      payload.set('image', file);
      const res = await fetch('/api/admin/images', { method: 'POST', body: payload });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setForm({ ...form, [target]: body.url });
    } catch (e) {
      onError(translate(language, e instanceof Error ? e.message : 'serverError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading admin-heading">
        <div>
          <span className="eyebrow">NEXUS / CONTROL ROOM</span>
          <h1>{t('adminTitle')}</h1>
          <p>{t('adminHint')}</p>
        </div>
        <button className="button primary" onClick={() => setForm({ ...empty })}>
          <Plus size={18} />
          {t('newGame')}
        </button>
      </div>
      <div className="admin-layout">
        <div className="admin-game-list">
          {games.map((game) => (
            <button
              className={form?.id === game.id ? 'active' : ''}
              key={game.id}
              onClick={() => setForm({ ...game, runtimeKey: game.runtimeKey ?? '' })}
            >
              <img src={game.cover} alt="" />
              <div>
                <strong>{game.title}</strong>
                <span>
                  {t(game.published ? 'published' : 'draft')} ·{' '}
                  {t(
                    game.status === 'AVAILABLE'
                      ? 'available'
                      : game.status === 'COMING_SOON'
                        ? 'comingSoon'
                        : 'draft',
                  )}
                </span>
              </div>
              <Edit3 size={17} />
            </button>
          ))}
        </div>
        {form ? (
          <form className="admin-form" onSubmit={save}>
            <div className="modal-heading">
              <h2>{t(form.id ? 'edit' : 'newGame')}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label={t('close')}
                onClick={() => setForm(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="form-columns">
              {(['title', 'slug'] as const).map((key) => (
                <label className="field-label" key={key}>
                  {t(key)}
                  <input
                    name={key}
                    required
                    minLength={key === 'slug' ? 3 : 2}
                    maxLength={key === 'slug' ? 64 : 80}
                    pattern={key === 'slug' ? '[a-z0-9]+(-[a-z0-9]+)*' : undefined}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            {(['description', 'descriptionEn'] as const).map((key) => (
              <label className="field-label" key={key}>
                {t(key === 'description' ? 'descriptionRu' : 'descriptionEn')}
                <textarea
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={3}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <div className="form-columns">
              <label className="field-label">
                {t('genre')}
                <select
                  value={form.genre}
                  onChange={(e) => setForm({ ...form, genre: e.target.value })}
                >
                  {['racing', 'shooter', 'adventure', 'exploration', 'puzzle'].map((g) => (
                    <option key={g} value={g}>
                      {t(g as TextKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {t('runtime')}
                <select
                  value={form.runtimeKey}
                  onChange={(e) => setForm({ ...form, runtimeKey: e.target.value })}
                >
                  <option value="">{t('noRuntime')}</option>
                  <option value="midnight-outlaws">MIDNIGHT OUTLAWS / Three.js</option>
                  <option value="nfs-underground">Underground / Local Experimental Adapter</option>
                  <option value="fold-zero">FOLD: ZERO / NEXUS FORGE</option>
                </select>
              </label>
            </div>
            <div className="form-columns">
              <label className="field-label">
                {t('status')}
                <select
                  aria-label={t('status')}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="DRAFT">{t('draft')}</option>
                  <option value="COMING_SOON">{t('comingSoon')}</option>
                  <option value="AVAILABLE">{t('available')}</option>
                </select>
              </label>
              <label className="field-label">
                {t('sortOrder')}
                <input
                  type="number"
                  min={0}
                  max={10000}
                  required
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>
            {(['cover', 'banner'] as const).map((key) => (
              <div key={key} className="admin-image-field">
                <label className="field-label">
                  {t(key)}
                  <input
                    value={form[key]}
                    required
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
                <label className="upload-button">
                  <Upload size={16} />
                  {t('upload')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => upload(e, key)}
                    disabled={busy}
                  />
                </label>
              </div>
            ))}
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setForm({ ...form, published: e.target.checked })}
              />
              {t('published')}
            </label>
            <div className="admin-form-actions">
              <button className="button primary" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{' '}
                {t('saveGame')}
              </button>
              {form.id && (
                <button
                  type="button"
                  className="danger-link"
                  disabled={busy}
                  onClick={() => remove(form.id!)}
                >
                  <Trash2 size={16} />
                  {t('deleteGame')}
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="admin-placeholder">
            <Edit3 size={30} />
            <p>
              {t('edit')} / {t('newGame')}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
