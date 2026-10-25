'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, Gamepad2, Plus, RotateCcw, Save, Settings2, Vibrate } from 'lucide-react';
import { nexusInput } from '@/input/manager';
import {
  actions,
  defaultConfig,
  layouts,
  type ControllerConfig,
  type InputAction,
  type InputBinding,
} from '@/input/profiles';
import { loadControllers, useControllers } from '@/input/store';
import { inputText } from '@/input/i18n';
import { useUI } from '@/lib/ui-store';
import { Modal } from './modal';
export function ControllerSettings() {
  const language = useUI((s) => s.language),
    account = useControllers(),
    state = useSyncExternalStore(
      nexusInput.subscribe,
      nexusInput.getSnapshot,
      nexusInput.getServerSnapshot,
    );
  const [config, setConfig] = useState<ControllerConfig>(defaultConfig()),
    [name, setName] = useState('NEXUS / 01'),
    [id, setId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [capture, setCapture] = useState<InputAction | null>(null),
    [raw, setRaw] = useState({ axes: [] as number[], buttons: [] as number[] });
  const t = (key: Parameters<typeof inputText>[1]) => inputText(language, key);
  useEffect(() => {
    setConfig(nexusInput.getSnapshot().config);
    void loadControllers(true)
      .then((data) => {
        if (!data) return;
        const profile = data.profiles.find((p: { id: string }) => p.id === data.activeId);
        if (profile) {
          setConfig(profile.config);
          setName(profile.name);
          setId(profile.id);
        } else setConfig(nexusInput.getSnapshot().config);
      })
      .catch(() => setNotice(inputText(useUI.getState().language, 'error')));
    return () => {
      nexusInput.capture(null);
      const store = useControllers.getState();
      const profile = store.profiles.find((p) => p.id === store.activeId);
      if (profile) nexusInput.setConfig(profile.config);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      const pad = nexusInput.raw();
      setRaw({ axes: [...(pad?.axes ?? [])], buttons: pad?.buttons.map((b) => b.value) ?? [] });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () =>
      nexusInput.on((event) => {
        if (event.type === 'capture' && capture) {
          const layout = config.layout === 'auto' ? state.layout : config.layout;
          const base =
            config.layout === 'auto' && layout === 'nintendo'
              ? defaultConfig('nintendo').bindings
              : config.bindings;
          const next = {
            ...config,
            layout,
            bindings: { ...base, [capture]: event.binding },
          };
          setConfig(next);
          nexusInput.setConfig(next);
          setCapture(null);
        } else if (event.type === 'captureCancelled') setCapture(null);
      }),
    [capture, config, state.layout],
  );
  function update(patch: Partial<ControllerConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    nexusInput.setConfig(next);
  }
  function binding(action: InputAction, patch: InputBinding) {
    const layout = config.layout === 'auto' ? state.layout : config.layout;
    const base =
      config.layout === 'auto' && layout === 'nintendo'
        ? defaultConfig('nintendo').bindings
        : config.bindings;
    update({ layout, bindings: { ...base, [action]: patch } });
  }
  async function persist(action: 'save' | 'delete' | 'activate', profileId = id) {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/controllers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'save'
            ? {
                action,
                id: profileId ?? undefined,
                name,
                deviceKey: state.devices.find((d) => d.index === state.activeIndex)?.key ?? null,
                config,
              }
            : { action, id: profileId },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      const next = await loadControllers(true);
      const selected = next.profiles.find((p: { id: string }) => p.id === next.activeId);
      setId(selected?.id ?? null);
      setConfig(selected?.config ?? defaultConfig());
      nexusInput.setConfig(selected?.config ?? defaultConfig());
      setName(selected?.name ?? 'NEXUS / 01');
      setNotice(t('saved'));
    } catch (e) {
      setNotice(
        e instanceof Error && e.message === 'profileLimit' ? t('profileLimit') : t('error'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="controller-settings" data-testid="controller-settings">
      <div className="controller-heading">
        <span className="eyebrow">NEXUS / INPUT</span>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </div>
      {notice && (
        <p className="social-feedback" role="status">
          {notice}
        </p>
      )}
      <div className="controller-layout">
        <section className="controller-devices">
          <h2>
            <Gamepad2 size={20} />
            {t('devices')}
          </h2>
          {!state.devices.length ? (
            <div className="controller-empty">
              <Gamepad2 size={48} />
              <h3>{t('noDevices')}</h3>
              <p>{t('discovery')}</p>
            </div>
          ) : (
            state.devices.map((device) => (
              <article
                key={device.index}
                className={`controller-device ${device.index === state.activeIndex ? 'selected' : ''}`}
              >
                <span className="controller-device-icon">
                  <Gamepad2 size={34} />
                </span>
                <div>
                  <h3>{device.id}</h3>
                  <p>{device.mapping === 'standard' ? t('standard') : t('unmapped')}</p>
                  <small>{t('unverified')}</small>
                  {!device.armed && <p>{t('neutral')}</p>}
                </div>
                <button
                  className="button secondary small"
                  onClick={() => nexusInput.setActive(device.index)}
                >
                  {device.index === state.activeIndex ? (
                    <>
                      <Check size={14} />
                      {t('active')}
                    </>
                  ) : (
                    t('use')
                  )}
                </button>
              </article>
            ))
          )}
          <div className="controller-sticks" aria-label={t('sticks')}>
            {[0, 2].map((axis, index) => (
              <div key={axis}>
                <span>{index === 0 ? 'L' : 'R'}</span>
                <div className="stick-circle">
                  <i
                    style={{
                      transform: `translate(${(raw.axes[axis] ?? 0) * 32}px,${(raw.axes[axis + 1] ?? 0) * 32}px)`,
                    }}
                  />
                </div>
                <code>
                  {(raw.axes[axis] ?? 0).toFixed(2)} / {(raw.axes[axis + 1] ?? 0).toFixed(2)}
                </code>
              </div>
            ))}
          </div>
          <h3 className="controller-test-title">{t('buttons')}</h3>
          <div className="controller-button-test">
            {raw.buttons.map((value, index) => (
              <span
                key={index}
                data-button-index={index}
                data-value={value.toFixed(2)}
                className={value > 0.1 ? 'pressed' : ''}
                style={{ '--pressure': value } as React.CSSProperties}
              >
                <strong>{index}</strong>
                <small>{value.toFixed(2)}</small>
              </span>
            ))}
          </div>
        </section>
        <section className="controller-profile-panel">
          <h2>{t('profiles')}</h2>
          <div className="controller-profiles">
            {account.profiles.map((profile) => (
              <button
                key={profile.id}
                className={id === profile.id ? 'selected' : ''}
                disabled={busy}
                onClick={() => {
                  setId(profile.id);
                  setName(profile.name);
                  setConfig(profile.config);
                  nexusInput.setConfig(profile.config);
                  void persist('activate', profile.id);
                }}
              >
                {profile.name}
                {profile.id === account.activeId && <Check size={14} />}
              </button>
            ))}
            <button
              disabled={busy || account.profiles.length >= 8}
              onClick={() => {
                setId(null);
                setName(`NEXUS / ${String(account.profiles.length + 1).padStart(2, '0')}`);
                update(defaultConfig());
              }}
            >
              <Plus size={14} />
              {t('newProfile')}
            </button>
          </div>
          <label className="controller-field">
            {t('profileName')}
            <input
              aria-label={t('profileName')}
              value={name}
              minLength={2}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="controller-field">
            {t('layout')}
            <select
              value={config.layout}
              aria-label={t('layout')}
              onChange={(e) => {
                const layout = e.target.value as ControllerConfig['layout'];
                update({
                  ...defaultConfig(layout),
                  deadZone: config.deadZone,
                  steeringSensitivity: config.steeringSensitivity,
                  vibrationEnabled: config.vibrationEnabled,
                  vibrationIntensity: config.vibrationIntensity,
                });
              }}
            >
              {layouts.map((layout) => (
                <option key={layout} value={layout}>
                  {t(layout)}
                </option>
              ))}
            </select>
          </label>
          <label className="controller-range">
            {t('deadZone')}
            <strong data-testid="deadzone-value">{Math.round(config.deadZone * 100)}%</strong>
            <input
              type="range"
              aria-label={t('deadZone')}
              min="0.02"
              max="0.45"
              step="0.01"
              value={config.deadZone}
              onChange={(e) => update({ deadZone: Number(e.target.value) })}
            />
          </label>
          <label className="controller-range">
            {t('sensitivity')}
            <strong>{config.steeringSensitivity.toFixed(2)}×</strong>
            <input
              type="range"
              aria-label={t('sensitivity')}
              min="0.35"
              max="2.5"
              step="0.05"
              value={config.steeringSensitivity}
              onChange={(e) => update({ steeringSensitivity: Number(e.target.value) })}
            />
          </label>
          {(
            [
              'invertSteer',
              'invertMoveY',
              'invertLookY',
              'swapConfirmCancel',
              'vibrationEnabled',
            ] as const
          ).map((key) => (
            <label className="controller-toggle" key={key}>
              <span>
                {t(
                  key === 'swapConfirmCancel'
                    ? 'swap'
                    : key === 'vibrationEnabled'
                      ? 'vibration'
                      : key,
                )}
              </span>
              <input
                type="checkbox"
                checked={config[key]}
                onChange={(e) => update({ [key]: e.target.checked })}
              />
            </label>
          ))}
          <label className="controller-range">
            {t('intensity')}
            <strong>{Math.round(config.vibrationIntensity * 100)}%</strong>
            <input
              type="range"
              aria-label={t('intensity')}
              min="0"
              max="1"
              step="0.05"
              value={config.vibrationIntensity}
              onChange={(e) => update({ vibrationIntensity: Number(e.target.value) })}
            />
          </label>
          <button
            className="button secondary"
            onClick={() =>
              void nexusInput.haptic('test').then((ok) => {
                if (!ok) setNotice(t('hapticsUnavailable'));
              })
            }
          >
            <Vibrate size={16} />
            {t('testVibration')}
          </button>
          <p className="controller-compat-note">{t('adaptive')}</p>
          <div className="controller-save-actions">
            <button
              className="button primary"
              disabled={busy || !account.userId}
              onClick={() => persist('save')}
            >
              <Save size={16} />
              {t('save')}
            </button>
            <button
              className="button secondary"
              onClick={() => update(defaultConfig(config.layout))}
            >
              <RotateCcw size={16} />
              {t('reset')}
            </button>
            {id && (
              <button className="text-button" disabled={busy} onClick={() => persist('delete')}>
                {t('delete')}
              </button>
            )}
          </div>
          {!account.userId && (
            <Link href="/login" className="back-link">
              {t('accountRequired')}
            </Link>
          )}
        </section>
      </div>
      <section className="controller-bindings">
        <h2>
          <Settings2 size={20} />
          {t('bindings')}
        </h2>
        {actions.map((action) => (
          <div className="controller-binding" key={action}>
            <strong>{t(action)}</strong>
            <select
              aria-label={`${t(action)} / ${t('button')}`}
              value={config.bindings[action].kind}
              onChange={(e) =>
                binding(
                  action,
                  e.target.value === 'button'
                    ? { kind: 'button', index: 0 }
                    : { kind: 'axis', index: 0, sign: 1, mode: 'signed' },
                )
              }
            >
              <option value="button">{t('button')}</option>
              <option value="axis">{t('axis')}</option>
            </select>
            <input
              aria-label={`${t(action)} / index`}
              type="number"
              min="0"
              max={config.bindings[action].kind === 'button' ? 63 : 15}
              value={config.bindings[action].index}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (
                  Number.isInteger(n) &&
                  n >= 0 &&
                  n <= (config.bindings[action].kind === 'button' ? 63 : 15)
                )
                  binding(action, { ...config.bindings[action], index: n });
              }}
            />
            {config.bindings[action].kind === 'axis' && (
              <select
                aria-label={`${t(action)} / ${t('axisMode')}`}
                value={(config.bindings[action] as Extract<InputBinding, { kind: 'axis' }>).mode}
                onChange={(e) =>
                  binding(action, {
                    ...(config.bindings[action] as Extract<InputBinding, { kind: 'axis' }>),
                    mode: e.target.value as 'signed' | 'positive' | 'trigger',
                  })
                }
              >
                {(['signed', 'positive', 'trigger'] as const).map((mode) => (
                  <option value={mode} key={mode}>
                    {t(mode)}
                  </option>
                ))}
              </select>
            )}
            <button
              className="button secondary small"
              disabled={state.activeIndex === null}
              onClick={() => {
                setCapture(action);
                nexusInput.capture(action);
              }}
            >
              {t('remap')}
            </button>
          </div>
        ))}
      </section>
      {capture && (
        <Modal
          title={`${t('remap')} / ${t(capture)}`}
          closeLabel={t('cancel')}
          onClose={() => {
            nexusInput.capture(null);
            setCapture(null);
          }}
        >
          <p className="controller-capture">
            <Gamepad2 size={40} />
            {t('listening')}
          </p>
        </Modal>
      )}
    </div>
  );
}
