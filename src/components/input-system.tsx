'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Gamepad2, X } from 'lucide-react';
import { nexusInput } from '@/input/manager';
import { spatialFocus, setNativeValue } from '@/input/focus';
import { loadControllers } from '@/input/store';
import { inputText } from '@/input/i18n';
import { useUI, playSound } from '@/lib/ui-store';
import type { InputAction } from '@/input/profiles';
import { Modal } from './modal';
export function InputGlyph({ action, fallback }: { action: InputAction; fallback: string }) {
  const state = useSyncExternalStore(
    nexusInput.subscribe,
    nexusInput.getSnapshot,
    nexusInput.getServerSnapshot,
  );
  return (
    <span className="input-glyph" data-device={state.method}>
      {state.method === 'gamepad' ? nexusInput.label(action) : fallback}
    </span>
  );
}
export function InputSystem() {
  const path = usePathname(),
    language = useUI((s) => s.language),
    state = useSyncExternalStore(
      nexusInput.subscribe,
      nexusInput.getSnapshot,
      nexusInput.getServerSnapshot,
    );
  const [notice, setNotice] = useState(''),
    [field, setField] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null),
    [select, setSelect] = useState<HTMLSelectElement | null>(null),
    [confirmation, setConfirmation] = useState<{
      message: string;
      resolve: (answer: boolean) => void;
    } | null>(null);
  const previousPath = useRef(path),
    fieldOriginal = useRef(''),
    lastRepeat = useRef({ direction: '', at: 0, started: 0 }),
    lastFrame = useRef(0),
    previous = useRef<Record<string, number>>({});
  const t = (key: Parameters<typeof inputText>[1]) => inputText(language, key);
  useEffect(() => nexusInput.start(), []);
  useEffect(() => {
    document.documentElement.dataset.inputMethod = state.method;
  }, [state.method]);
  useEffect(() => {
    void loadControllers().catch(() => {});
    previousPath.current = path;
    let restored = false;
    const restore = () => {
      if (nexusInput.getSnapshot().method === 'gamepad' && !restored)
        restored = spatialFocus.restore(path);
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    const frame = requestAnimationFrame(restore);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [path]);
  useEffect(() => {
    const focus = () => spatialFocus.remember(location.pathname);
    document.addEventListener('focusin', focus);
    return () => document.removeEventListener('focusin', focus);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const request = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; resolve: (v: boolean) => void }>)
        .detail;
      setConfirmation((old) => {
        old?.resolve(false);
        return detail;
      });
    };
    window.addEventListener('nexus-confirm', request);
    return () => window.removeEventListener('nexus-confirm', request);
  }, []);
  function back() {
    const dialog = spatialFocus.scope();
    const close = dialog.querySelector<HTMLButtonElement>('[data-close-dialog]');
    const gameBack = document.querySelector<HTMLButtonElement>('[data-game-back]');
    if (close) close.click();
    else if (gameBack) gameBack.click();
    else if (location.pathname !== '/') history.back();
  }
  useEffect(() => {
    const confirm = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return;
      if (el instanceof HTMLSelectElement) {
        setSelect(el);
        return;
      }
      if (
        (el instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'range', 'number', 'submit', 'button', 'file'].includes(
            el.type,
          )) ||
        el instanceof HTMLTextAreaElement
      ) {
        fieldOriginal.current = el.value;
        setField(el);
        return;
      }
      if (el instanceof HTMLInputElement && el.type === 'number') {
        fieldOriginal.current = el.value;
        setField(el);
        return;
      }
      el.click();
      void nexusInput.haptic('confirm');
      playSound('confirm');
    };
    const off = nexusInput.on((event) => {
      if (event.type === 'connected' || event.type === 'disconnected') {
        setNotice(`${inputText(language, event.type)} · ${event.device.id}`);
        return;
      }
      if (event.type !== 'frame') return;
      const dt = lastFrame.current ? event.time - lastFrame.current : 16;
      lastFrame.current = event.time;
      const released = nexusInput.isNeutral();
      const releasedFlag = String(released);
      if (document.documentElement.dataset.controllerReleased !== releasedFlag)
        document.documentElement.dataset.controllerReleased = releasedFlag;
      const values = event.values,
        old = previous.current;
      previous.current = { ...values };
      if (nexusInput.scope !== 'ui' || nexusInput.getSnapshot().method !== 'gamepad') return;
      const pressed = (action: InputAction) => values[action] > 0.5 && (old[action] ?? 0) <= 0.5;
      if (
        [
          'confirm',
          'cancel',
          'context',
          'previousSection',
          'nextSection',
          'library',
          'navUp',
          'navDown',
          'navLeft',
          'navRight',
        ].some((action) => pressed(action as InputAction))
      )
        document.documentElement.dataset.controllerCommand = String(
          Number(document.documentElement.dataset.controllerCommand ?? 0) + 1,
        );
      const x = values.moveX,
        y = values.moveY;
      const direction =
        values.navLeft > 0.5
          ? 'left'
          : values.navRight > 0.5
            ? 'right'
            : values.navUp > 0.5
              ? 'up'
              : values.navDown > 0.5
                ? 'down'
                : x < -0.55
                  ? 'left'
                  : x > 0.55
                    ? 'right'
                    : y < -0.55
                      ? 'up'
                      : y > 0.55
                        ? 'down'
                        : null;
      if (direction) {
        const repeat = lastRepeat.current;
        if (direction !== repeat.direction) {
          lastRepeat.current = { direction, at: event.time, started: event.time };
          spatialFocus.move(direction);
        } else if (event.time - repeat.at > (event.time - repeat.started < 450 ? 350 : 130)) {
          repeat.at = event.time;
          spatialFocus.move(direction);
          playSound('focus');
        }
      } else lastRepeat.current.direction = '';
      if (pressed('confirm')) confirm();
      if (pressed('cancel')) back();
      if (pressed('previousSection') || pressed('nextSection')) {
        if (document.querySelector('dialog[open]')) return;
        const sections = [...document.querySelectorAll<HTMLAnchorElement>('[data-section-link]')];
        const index = sections.findIndex((el) => el.pathname === location.pathname);
        const next =
          sections[
            (Math.max(0, index) + (pressed('nextSection') ? 1 : -1) + sections.length) %
              sections.length
          ];
        next?.click();
      }
      if (pressed('library') && !document.querySelector('dialog[open]'))
        document.querySelector<HTMLAnchorElement>('[data-library-link]')?.click();
      if (pressed('context')) {
        const scope = spatialFocus.scope();
        const done =
          scope.querySelector<HTMLButtonElement>('[data-osk-done]') ??
          scope.querySelector<HTMLButtonElement>('[data-game-resume]');
        if (done) done.click();
        else if (scope === document) {
          const el = document.activeElement as HTMLElement | null;
          if (el?.closest('[data-game-id]'))
            el.dispatchEvent(new CustomEvent('nexus-context', { bubbles: true }));
          else document.querySelector<HTMLAnchorElement>('[data-controller-settings]')?.click();
        }
      }
      if (Math.abs(values.lookX) > 0.1 || Math.abs(values.lookY) > 0.1)
        spatialFocus.scroll(values.lookX, values.lookY, dt);
    });
    const key = (event: KeyboardEvent) => {
      if (nexusInput.scope !== 'ui') return;
      if (
        (event.target as HTMLElement).matches('input,textarea,select') &&
        !document.querySelector('.osk-dialog')
      )
        return;
      const direction = (
        { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const
      )[event.key as 'ArrowLeft'];
      if (direction) {
        event.preventDefault();
        spatialFocus.move(direction);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      off();
      window.removeEventListener('keydown', key);
    };
  }, [language]);
  function closeKeyboard(cancel = false) {
    if (field && cancel) setNativeValue(field, fieldOriginal.current);
    const target = field;
    setField(null);
    requestAnimationFrame(() => target?.focus());
  }
  return (
    <>
      {notice && (
        <div className="controller-notice" role="status">
          <Gamepad2 size={19} />
          <span>{notice}</span>
          <button className="icon-button" onClick={() => setNotice('')} aria-label={t('back')}>
            <X size={16} />
          </button>
        </div>
      )}
      {state.method === 'gamepad' && (
        <aside className="controller-hints" aria-label={t('method')}>
          <span>
            <InputGlyph action="confirm" fallback="↵" />
            {t('confirm')}
          </span>
          <span>
            <InputGlyph action="cancel" fallback="Esc" />
            {t('back')}
          </span>
          <Link href="/controllers" data-controller-settings>
            <InputGlyph action="context" fallback="Menu" />
            {t('controllers')}
          </Link>
        </aside>
      )}
      {field && (
        <ScreenKeyboard
          field={field}
          language={language}
          onDone={() => closeKeyboard()}
          onCancel={() => closeKeyboard(true)}
        />
      )}
      {select && (
        <Modal title={t('choose')} closeLabel={t('back')} onClose={() => setSelect(null)}>
          <div className="controller-select-options">
            {[...select.options].map((option, index) => (
              <button
                key={index}
                disabled={option.disabled}
                autoFocus={select.value === option.value}
                className={select.value === option.value ? 'selected' : ''}
                onClick={() => {
                  setNativeValue(select, option.value);
                  const target = select;
                  setSelect(null);
                  requestAnimationFrame(() => target.focus());
                }}
              >
                {option.text}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={t('confirmRemove')}
          closeLabel={t('cancel')}
          onClose={() => {
            confirmation.resolve(false);
            setConfirmation(null);
          }}
        >
          <p className="controller-confirm-copy">{confirmation.message}</p>
          <div className="controller-confirm-actions">
            <button
              autoFocus
              className="button secondary"
              onClick={() => {
                confirmation.resolve(false);
                setConfirmation(null);
              }}
            >
              {t('cancel')}
            </button>
            <button
              className="button primary"
              onClick={() => {
                confirmation.resolve(true);
                setConfirmation(null);
              }}
            >
              {t('yes')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ScreenKeyboard({
  field,
  language,
  onDone,
  onCancel,
}: {
  field: HTMLInputElement | HTMLTextAreaElement;
  language: 'ru' | 'en';
  onDone: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(field.value),
    [upper, setUpper] = useState(false),
    [symbols, setSymbols] = useState(false),
    [cyrillic, setCyrillic] = useState(false);
  const t = (key: Parameters<typeof inputText>[1]) => inputText(language, key);
  const sensitive = field instanceof HTMLInputElement && field.type === 'password';
  const rows = symbols
    ? ['1234567890', '!@#$%^&*()', '_-+=.,:;?/', '[]{}\\|<>~`']
    : cyrillic
      ? ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю']
      : ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm@._'];
  function update(next: string) {
    const limit = field.maxLength > 0 ? field.maxLength : 4000;
    const clipped = next.slice(0, limit);
    setNativeValue(field, clipped);
    setValue(clipped);
  }
  return (
    <Modal title={t('keyboard')} closeLabel={t('cancel')} onClose={onCancel}>
      <div className="osk-dialog" data-testid="screen-keyboard">
        <div className="osk-preview" aria-label={field.labels?.[0]?.textContent ?? field.name}>
          {sensitive ? '•'.repeat(value.length) : value || '│'}
          <span>{value.length}</span>
        </div>
        <div className="osk-grid">
          {rows.map((row, index) => (
            <div key={index} className="osk-row">
              {[...row].map((char, i) => {
                const key = upper ? char.toUpperCase() : char;
                return (
                  <button
                    type="button"
                    data-osk-key={key}
                    autoFocus={index === 0 && i === 0}
                    key={char}
                    aria-label={key}
                    onClick={() => update(value + key)}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="osk-tools">
          <button onClick={() => setUpper(!upper)} aria-pressed={upper}>
            {t('shift')}
          </button>
          <button onClick={() => setSymbols(!symbols)}>{t(symbols ? 'letters' : 'symbols')}</button>
          <button onClick={() => setCyrillic(!cyrillic)}>{cyrillic ? 'ABC' : 'АБВ'}</button>
          <button data-osk-key="space" onClick={() => update(value + ' ')}>
            {t('space')}
          </button>
          <button data-osk-key="backspace" onClick={() => update([...value].slice(0, -1).join(''))}>
            {t('erase')}
          </button>
          <button onClick={() => update('')}>{t('clear')}</button>
        </div>
        <button data-osk-done className="button primary osk-done" onClick={onDone}>
          {t('done')}
          <InputGlyph action="context" fallback="Menu" />
        </button>
      </div>
    </Modal>
  );
}
export function GameControlsHint({ fallback }: { fallback: string }) {
  const language = useUI((s) => s.language),
    state = useSyncExternalStore(
      nexusInput.subscribe,
      nexusInput.getSnapshot,
      nexusInput.getServerSnapshot,
    );
  if (state.method !== 'gamepad') return <>{fallback}</>;
  return (
    <>
      {(['steer', 'accelerate', 'brake', 'boost', 'handbrake', 'camera', 'pause'] as const).map(
        (action, index) => (
          <span className="inline-control" key={action}>
            {index > 0 ? ' · ' : ''}
            <InputGlyph action={action} fallback="" />
            {inputText(language, action)}
          </span>
        ),
      )}
    </>
  );
}
