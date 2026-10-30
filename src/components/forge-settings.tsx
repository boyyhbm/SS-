'use client';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Gamepad2,
  Keyboard,
  Monitor,
  Mouse,
  RotateCcw,
  Volume2,
  X,
} from 'lucide-react';
import { nexusInput } from '@/input/manager';
import { buttonLabel, detectLayout, type InputBinding } from '@/input/profiles';
import {
  assignForgeBinding,
  bindingConflict,
  forgeActionText,
  forgeBindingLabel,
  padConflict,
  resolvePadBinding,
} from '@/games/fold/bindings';
import {
  defaultForgeSettings,
  forgeActions,
  forgeBindingSchema,
  forgeSettingsSchema,
  padActions,
  type ForgeAction,
  type ForgeBinding,
  type ForgePadAction,
  type ForgePadBinding,
  type ForgeSettings,
} from '@/games/fold/settings';
import type { ForgeSettingsState } from '@/games/fold/settings-store';
import type { ForgePointerStatus } from '@/games/fold/input';
import { ForgeCrosshair } from './forge-crosshair';
import './forge-settings.css';

const tabs = [
  { id: 'keys', label: 'Клавиши', sub: 'Controls', icon: Keyboard },
  { id: 'mouse', label: 'Мышь', sub: 'Mouse', icon: Mouse },
  { id: 'controller', label: 'Геймпад', sub: 'Controller', icon: Gamepad2 },
  { id: 'crosshair', label: 'Прицел', sub: 'Crosshair', icon: Crosshair },
  { id: 'graphics', label: 'Графика', sub: 'Graphics', icon: Monitor },
  { id: 'audio', label: 'Звук', sub: 'Audio', icon: Volume2 },
] as const;
type Tab = (typeof tabs)[number]['id'];
type Capture = { kind: 'key'; action: ForgeAction } | { kind: 'pad'; action: ForgePadAction };
type Conflict =
  | { kind: 'key'; action: ForgeAction; other: ForgeAction; binding: ForgeBinding }
  | { kind: 'pad'; action: ForgePadAction; other: ForgePadAction; binding: ForgePadBinding };
type Props = {
  sync: ForgeSettingsState;
  onApply: (settings: ForgeSettings) => void;
  onPreview: (settings: ForgeSettings | null) => void;
  onClose: () => void;
  onUseCloud: () => void;
  onKeepLocal: (settings: ForgeSettings) => void;
  onRetry: () => void;
  onFullscreen: () => void;
  onTestAudio: () => void;
  onTestVibration: (intensity: number) => void;
  pointerStatus: ForgePointerStatus;
  capabilities: { msaaSamples: number; ssao: boolean; bloom: boolean };
  inMatch: boolean;
};
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="fz-setting-row">
      <div>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <div className="fz-setting-control">{children}</div>
    </div>
  );
}
function Slider({
  label,
  hint,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  suffix = '',
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (
    <Row label={label} hint={hint}>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>
        {value.toFixed(digits)}
        {suffix}
      </output>
    </Row>
  );
}
function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        className="fz-switch"
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <span />
        {value ? 'Вкл' : 'Выкл'}
      </button>
    </Row>
  );
}
function Choice<T extends string | number>({
  label,
  hint,
  value,
  items,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  items: readonly (readonly [T, string, boolean?])[];
  onChange: (value: T) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(items.find((i) => String(i[0]) === e.target.value)![0])}
      >
        {items.map(([key, text, disabled]) => (
          <option key={key} value={key} disabled={disabled}>
            {text}
          </option>
        ))}
      </select>
    </Row>
  );
}
export function ForgeSettingsScreen(props: Props) {
  const { sync, onPreview } = props;
  const [draft, setDraft] = useState(() => structuredClone(sync.settings));
  const [base, setBase] = useState(sync.settings);
  const [tab, setTab] = useState<Tab>('mouse');
  const [capture, setCapture] = useState<Capture | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'reset' | null>(null);
  const [message, setMessage] = useState('');
  const [padPreview, setPadPreview] = useState({ leftX: 0, leftY: 0, rightX: 0, rightY: 0 });
  const root = useRef<HTMLDialogElement>(null);
  const tabEdges = useRef({ left: 0, right: 0 });
  const inputState = useSyncExternalStore(
    nexusInput.subscribe,
    nexusInput.getSnapshot,
    nexusInput.getServerSnapshot,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  // Cloud acknowledgements may replace the baseline, but never erase an open edit.
  if (base !== sync.settings) {
    if (!dirty) setDraft(structuredClone(sync.settings));
    setBase(sync.settings);
  }
  function update<K extends keyof ForgeSettings>(key: K, value: ForgeSettings[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onPreview(next);
    setMessage('');
  }
  function field<
    K extends 'mouse' | 'controller' | 'crosshair' | 'graphics' | 'audio',
    P extends keyof ForgeSettings[K],
  >(key: K, name: P, value: ForgeSettings[K][P]) {
    update(key, { ...draft[key], [name]: value });
  }
  function close() {
    if (dirty) setConfirm('discard');
    else {
      onPreview(null);
      props.onClose();
    }
  }
  function proposeKey(action: ForgeAction, binding: ForgeBinding) {
    if (binding.kind === 'key' && binding.code === 'Escape' && action !== 'menu') {
      setMessage('Esc всегда открывает меню. Выберите другую клавишу.');
      return;
    }
    const other = bindingConflict(draft.keys, action, binding);
    if (other) setConflict({ kind: 'key', action, other, binding });
    else update('keys', assignForgeBinding(draft.keys, action, binding, false));
  }
  const raw = nexusInput.raw();
  const padLayout =
    inputState.config.layout === 'auto'
      ? detectLayout(raw?.id ?? '', raw?.mapping ?? '')
      : inputState.config.layout;
  const labelPad = (binding: ForgePadBinding) =>
    buttonLabel(resolvePadBinding(binding, inputState.config, raw), padLayout);
  function proposePad(action: ForgePadAction, binding: ForgePadBinding) {
    const physical = resolvePadBinding(binding, inputState.config, nexusInput.raw());
    if (physical.kind === 'button' && physical.index === 9 && action !== 'menu') {
      setMessage('Menu / Options зарезервирована для меню.');
      return;
    }
    const other = padConflict(
      draft.controller.bindings,
      action,
      binding,
      inputState.config,
      nexusInput.raw(),
    );
    if (other) setConflict({ kind: 'pad', action, other, binding });
    else field('controller', 'bindings', { ...draft.controller.bindings, [action]: binding });
  }
  function swap() {
    if (!conflict) return;
    try {
      if (conflict.kind === 'key')
        update('keys', assignForgeBinding(draft.keys, conflict.action, conflict.binding, true));
      else {
        const map = draft.controller.bindings,
          old = resolvePadBinding(map[conflict.action], inputState.config, nexusInput.raw());
        if (old.kind === 'button' && old.index === 9 && conflict.other !== 'menu')
          throw Error('reservedSwap');
        field('controller', 'bindings', {
          ...map,
          [conflict.action]: conflict.binding,
          [conflict.other]: map[conflict.action],
        });
      }
      setConflict(null);
    } catch {
      setConflict(null);
      setMessage(
        'Сначала назначьте меню другую кнопку. Резервная кнопка не может перейти к игровому действию.',
      );
    }
  }
  function apply() {
    const parsed = forgeSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage('Проверьте назначения: у каждого действия должна быть отдельная клавиша.');
      return;
    }
    props.onApply(parsed.data);
    setBase(parsed.data);
    onPreview(null);
    setMessage('Настройки применены.');
  }
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => onPreview(null);
  }, [onPreview]);
  // The platform's one input poll owns both normal UI navigation and capture.
  // Capture scope suppresses confirm/back so a mapped button cannot close a menu.
  useEffect(() => {
    if (!capture) return;
    const release = nexusInput.acquire('capture');
    let armed = false;
    const baseline = [...(nexusInput.raw()?.axes ?? [])];
    const finish = () => setCapture(null);
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        finish();
        return;
      }
      if (capture.kind !== 'key' || e.repeat) return;
      if (['F5', 'F11', 'F12', 'MetaLeft', 'MetaRight'].includes(e.code)) {
        setMessage('Эта клавиша используется браузером.');
        return;
      }
      const parsed = forgeBindingSchema.safeParse({ kind: 'key', code: e.code });
      if (!parsed.success) {
        setMessage('Эта клавиша не поддерживается.');
        return;
      }
      proposeKey(capture.action, parsed.data);
      finish();
    };
    const mouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if ((e.target as Element | null)?.closest?.('[data-cancel-capture]')) {
        finish();
        return;
      }
      if (capture.kind === 'key' && e.button <= 4) {
        proposeKey(capture.action, { kind: 'mouse', button: e.button });
        finish();
      }
    };
    const off = nexusInput.on((event) => {
      if (event.type !== 'frame') return;
      const pad = nexusInput.raw();
      if (!pad) return;
      if (!armed) {
        if (
          pad.buttons.every((b) => b.value < 0.2) &&
          pad.axes.every((v, i) => i < 4 || Math.abs(v - (baseline[i] ?? v)) < 0.2)
        )
          armed = true;
        return;
      }
      if (capture.kind === 'key') {
        if ((pad.buttons[9]?.value ?? 0) > 0.65) finish();
        return;
      }
      const index = pad.buttons.findIndex((b) => b.value > 0.65);
      let binding: InputBinding | null = index >= 0 ? { kind: 'button', index } : null;
      if (!binding) {
        const axis = pad.axes.findIndex(
          (v, i) => i >= 4 && Math.abs(v - (baseline[i] ?? v)) > 0.65,
        );
        if (axis >= 0)
          binding = {
            kind: 'axis',
            index: axis,
            sign: pad.axes[axis] > baseline[axis] ? 1 : -1,
            mode: Math.abs(baseline[axis]) > 0.6 ? 'trigger' : 'positive',
          };
      }
      if (binding) {
        if (binding.kind === 'button' && binding.index === 9 && capture.action !== 'menu') {
          finish();
          return;
        }
        proposePad(capture.action, binding);
        finish();
      }
    });
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousedown', mouse, true);
    return () => {
      release();
      off();
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('mousedown', mouse, true);
    };
    // Draft/config are fixed during this short capture; reopening starts fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);
  useEffect(() => {
    let last = 0;
    return nexusInput.on((e) => {
      if (e.type !== 'frame') return;
      const previousLeft = tabEdges.current.left,
        previousRight = tabEdges.current.right;
      tabEdges.current = { left: e.values.previousSection, right: e.values.nextSection };
      if (capture || nexusInput.scope !== 'ui') return;
      if (!conflict && !confirm) {
        if (
          (e.values.previousSection > 0.5 && previousLeft <= 0.5) ||
          (e.values.nextSection > 0.5 && previousRight <= 0.5)
        ) {
          const direction = e.values.nextSection > 0.5 ? 1 : -1;
          setTab(
            (t) =>
              tabs[(tabs.findIndex((v) => v.id === t) + direction + tabs.length) % tabs.length].id,
          );
        }
      }
      if (e.time - last < 150 || tab !== 'controller') return;
      last = e.time;
      const p = nexusInput.raw();
      setPadPreview({
        leftX: p?.axes[0] ?? 0,
        leftY: p?.axes[1] ?? 0,
        rightX: p?.axes[2] ?? 0,
        rightY: p?.axes[3] ?? 0,
      });
    });
  }, [capture, conflict, confirm, tab]);
  // Escape cancels the innermost operation. Tab stays within the visible dialog.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (capture) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (conflict) setConflict(null);
        else if (confirm) setConfirm(null);
        else close();
      }
      if (e.code === 'Tab') {
        const scope = [...document.querySelectorAll('dialog[open]')].at(-1);
        const all = [
          ...(scope?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
          ) ?? []),
        ].filter((el) => el.getClientRects().length);
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  useEffect(() => {
    if (conflict || confirm)
      root.current?.querySelector<HTMLButtonElement>('.fz-settings-modal button')?.focus();
  }, [conflict, confirm]);
  const syncText = {
    loading: 'Подключение к аккаунту…',
    cloud: 'Сохранено в аккаунте',
    saving: 'Синхронизация…',
    local: 'На этом устройстве · повторить синхронизацию',
    conflict: 'В аккаунте есть другая версия настроек',
    'account-changed': 'Аккаунт изменился. Перезагрузите игру перед сохранением.',
  }[sync.status];
  const mouseStatus = {
    idle: 'Захват мыши ещё не запрошен',
    standard: 'Стандартный Pointer Lock',
    'raw-requested': 'Raw Input запрошен; браузер не сообщает, применён ли режим',
    'raw-unavailable': 'Raw Input отклонён · стандартный Pointer Lock',
    unavailable: 'Захват недоступен. Нажмите по игровой сцене ещё раз.',
  }[props.pointerStatus];
  const g = draft.graphics,
    c = draft.controller,
    m = draft.mouse,
    x = draft.crosshair;
  return (
    <dialog
      open
      ref={root}
      onContextMenu={(e) => e.preventDefault()}
      className="fz-settings"
      aria-label="Настройки FOLD ZERO"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="fz-settings-head">
        <div>
          <span className="forge-kicker">TUNE YOUR EDGE / FOLD: ZERO</span>
          <h1>Твоё управление.</h1>
          <p>
            {props.inMatch
              ? 'Дуэль продолжается. Пока открыто меню, персонаж не получает команды.'
              : 'Персональная конфигурация FOLD: ZERO.'}
          </p>
        </div>
        <button aria-label="Закрыть настройки" data-game-back onClick={close}>
          <X />
        </button>
      </header>
      <nav className="fz-settings-tabs" role="tablist" aria-label="Разделы настроек">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={'fz-panel-' + t.id}
            id={'fz-tab-' + t.id}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={19} />
            <span>
              {t.label}
              <small>{t.sub}</small>
            </span>
          </button>
        ))}
      </nav>
      <section
        className="fz-settings-body"
        role="tabpanel"
        id={'fz-panel-' + tab}
        aria-labelledby={'fz-tab-' + tab}
      >
        <div className="fz-section-heading">
          <div>
            <span>CONFIG / {tabs.find((t) => t.id === tab)?.sub.toUpperCase()}</span>
            <h2>{tabs.find((t) => t.id === tab)?.label}</h2>
          </div>
          <button className="fz-quiet" onClick={() => setConfirm('reset')}>
            <RotateCcw size={14} /> Сбросить раздел
          </button>
        </div>
        {tab === 'keys' && (
          <>
            <p className="fz-explanation">
              Нажмите назначение, затем клавишу или кнопку мыши. Esc отменяет захват и всегда
              остаётся доступным для меню.
            </p>
            <div className="fz-bindings">
              {forgeActions.map((action) => (
                <div className="fz-binding" key={action}>
                  <span>
                    {forgeActionText[action]}
                    {action === 'interact' && <small>Вторая клавиша активации узла</small>}
                  </span>
                  <button
                    aria-label={'Назначить: ' + forgeActionText[action]}
                    className="fz-keycap"
                    onClick={() => setCapture({ kind: 'key', action })}
                  >
                    {forgeBindingLabel(draft.keys[action])}
                  </button>
                  <button
                    className="fz-reset-key"
                    aria-label={'Сбросить: ' + forgeActionText[action]}
                    onClick={() => proposeKey(action, defaultForgeSettings.keys[action])}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === 'mouse' && (
          <>
            <p className="fz-explanation">
              1.00× — исходная скорость. Ввод без дополнительного ускорения, чувствительность не
              зависит от FPS.
            </p>
            <Slider
              label="Общая чувствительность"
              value={m.sensitivity}
              min={0.1}
              max={5}
              suffix="×"
              onChange={(v) => field('mouse', 'sensitivity', v)}
            />
            <Slider
              label="Чувствительность X"
              value={m.x}
              min={0.1}
              max={3}
              suffix="×"
              onChange={(v) => field('mouse', 'x', v)}
            />
            <Slider
              label="Чувствительность Y"
              value={m.y}
              min={0.1}
              max={3}
              suffix="×"
              onChange={(v) => field('mouse', 'y', v)}
            />
            <Slider
              label="Множитель ADS мыши"
              hint="Скорость обзора при удержании прицеливания"
              value={m.ads}
              min={0.1}
              max={2}
              suffix="×"
              onChange={(v) => field('mouse', 'ads', v)}
            />
            <Toggle
              label="Инверсия Y мыши"
              value={m.invertY}
              onChange={(v) => field('mouse', 'invertY', v)}
            />
            <Toggle
              label="Запрашивать Raw Mouse Input"
              hint="Применяется при следующем захвате. Если браузер откажет, используется стандартный режим."
              value={m.rawInput}
              onChange={(v) => field('mouse', 'rawInput', v)}
            />
            <p className="fz-device-status">{mouseStatus}</p>
          </>
        )}
        {tab === 'controller' && (
          <>
            <div className="fz-controller-overview">
              <Gamepad2 size={72} strokeWidth={1} />
              <div>
                <strong>
                  {inputState.devices.find((d) => d.index === inputState.activeIndex)?.id ??
                    'Нажмите кнопку подключённого геймпада'}
                </strong>
                <p>LS · движение / RS · обзор</p>
                <div className="fz-stick-meters">
                  {(['left', 'right'] as const).map((stick) => (
                    <div key={stick}>
                      <i
                        style={{
                          transform: `translate(${padPreview[stick === 'left' ? 'leftX' : 'rightX'] * 18}px, ${padPreview[stick === 'left' ? 'leftY' : 'rightY'] * 18}px)`,
                        }}
                      />
                      <span>{stick === 'left' ? 'LS' : 'RS'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Slider
              label="Чувствительность стика X"
              value={c.x}
              min={0.2}
              max={3}
              suffix="×"
              onChange={(v) => field('controller', 'x', v)}
            />
            <Slider
              label="Чувствительность стика Y"
              value={c.y}
              min={0.2}
              max={3}
              suffix="×"
              onChange={(v) => field('controller', 'y', v)}
            />
            <Slider
              label="Deadzone левого стика"
              value={c.leftDeadzone}
              max={0.45}
              onChange={(v) => field('controller', 'leftDeadzone', v)}
            />
            <Slider
              label="Deadzone правого стика"
              value={c.rightDeadzone}
              max={0.45}
              onChange={(v) => field('controller', 'rightDeadzone', v)}
            />
            <Choice
              label="Кривая прицеливания"
              value={c.curve}
              items={[
                ['linear', 'Linear · линейная'],
                ['dynamic', 'Dynamic · плавная'],
                ['precision', 'Precision · точная'],
              ]}
              onChange={(v) => field('controller', 'curve', v)}
            />
            {c.curve === 'precision' && (
              <Slider
                label="Показатель Precision"
                value={c.precisionExponent}
                min={1}
                max={2.5}
                onChange={(v) => field('controller', 'precisionExponent', v)}
              />
            )}
            <Slider
              label="Множитель ADS геймпада"
              value={c.ads}
              min={0.1}
              max={2}
              suffix="×"
              onChange={(v) => field('controller', 'ads', v)}
            />
            <Toggle
              label="Инверсия Y геймпада"
              value={c.invertY}
              onChange={(v) => field('controller', 'invertY', v)}
            />
            <Toggle
              label="Вибрация"
              value={c.vibration}
              onChange={(v) => field('controller', 'vibration', v)}
            />
            <Slider
              label="Сила вибрации"
              value={c.vibrationIntensity}
              onChange={(v) => field('controller', 'vibrationIntensity', v)}
            />
            <button
              className="fz-quiet"
              disabled={
                !inputState.devices.find((d) => d.index === inputState.activeIndex)?.haptics ||
                !c.vibration
              }
              onClick={() => props.onTestVibration(c.vibrationIntensity)}
            >
              Проверить вибрацию
            </button>
            <p className="fz-explanation">
              Menu / Options всегда открывает меню. Назначения ниже меняют только FOLD: ZERO. LB /
              RB переключают вкладки настроек.
            </p>
            <div className="fz-bindings">
              {padActions.map((action) => (
                <div className="fz-binding" key={action}>
                  <span>{forgeActionText[action]}</span>
                  <button
                    className="fz-keycap"
                    aria-label={'Геймпад: ' + forgeActionText[action]}
                    onClick={() => setCapture({ kind: 'pad', action })}
                  >
                    {labelPad(c.bindings[action])}
                  </button>
                  <button
                    className="fz-reset-key"
                    aria-label={'Сбросить геймпад: ' + forgeActionText[action]}
                    onClick={() =>
                      proposePad(action, defaultForgeSettings.controller.bindings[action])
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === 'crosshair' && (
          <>
            <div className="fz-crosshair-stage">
              <div className="fz-target-lines" />
              <ForgeCrosshair settings={x} spread={x.dynamic ? 4 : 0} preview />
              <span>LIVE PREVIEW · без данных о противнике</span>
            </div>
            <Row label="Цвет прицела">
              <input
                aria-label="Цвет прицела"
                type="color"
                value={x.color}
                onChange={(e) => field('crosshair', 'color', e.target.value)}
              />
              <output>{x.color.toUpperCase()}</output>
            </Row>
            <Slider
              label="Размер прицела"
              value={x.size}
              min={2}
              max={20}
              step={1}
              suffix=" px"
              onChange={(v) => field('crosshair', 'size', v)}
            />
            <Slider
              label="Толщина прицела"
              value={x.thickness}
              min={1}
              max={5}
              step={1}
              suffix=" px"
              onChange={(v) => field('crosshair', 'thickness', v)}
            />
            <Slider
              label="Прозрачность прицела"
              value={x.opacity}
              onChange={(v) => field('crosshair', 'opacity', v)}
            />
            <Slider
              label="Зазор прицела"
              value={x.gap}
              max={16}
              step={1}
              suffix=" px"
              onChange={(v) => field('crosshair', 'gap', v)}
            />
            <Toggle
              label="Контур прицела"
              value={x.outline}
              onChange={(v) => field('crosshair', 'outline', v)}
            />
            <Toggle
              label="Центральная точка"
              value={x.dot}
              onChange={(v) => field('crosshair', 'dot', v)}
            />
            <Toggle
              label="Динамический прицел"
              hint="Расширяется при движении своего персонажа и стрельбе"
              value={x.dynamic}
              onChange={(v) => field('crosshair', 'dynamic', v)}
            />
          </>
        )}
        {tab === 'graphics' && (
          <>
            <Choice
              label="Графика FOLD"
              value={g.quality}
              items={['auto', 'competitive', 'low', 'medium', 'high', 'ultra'].map(
                (q) => [q as typeof g.quality, q.toUpperCase()] as const,
              )}
              hint="Auto измеряет время реальных кадров до боя. Пресет меняет разрешение, тени и второстепенные детали."
              onChange={(v) => field('graphics', 'quality', v)}
            />
            <Slider
              label="Масштаб рендера"
              value={g.renderScale}
              min={0.5}
              max={1.3}
              suffix="×"
              onChange={(v) => field('graphics', 'renderScale', v)}
            />
            <Choice
              label="Текстуры"
              hint="Размер заранее загруженных PBR-карт пола"
              value={g.texture}
              items={[
                ['low', 'Low · 256'],
                ['medium', 'Medium · 512'],
                ['high', 'High · 1024'],
              ]}
              onChange={(v) => field('graphics', 'texture', v)}
            />
            <Choice
              label="Тени"
              value={g.shadows}
              items={[
                ['preset', 'По пресету'],
                ['off', 'Выключены'],
                ['low', 'Low · 512'],
                ['medium', 'Medium · 1024'],
                ['high', 'High · 2048'],
              ]}
              onChange={(v) => field('graphics', 'shadows', v)}
            />
            <Choice
              label="Сглаживание"
              value={g.aa}
              items={[
                [
                  'msaa',
                  `MSAA ${props.capabilities.msaaSamples}×`,
                  !props.capabilities.msaaSamples,
                ],
                ['fxaa', 'FXAA'],
                ['off', 'Выключено'],
              ]}
              onChange={(v) => field('graphics', 'aa', v)}
            />
            <Choice
              label="Качество эффектов"
              hint="Количество частиц попаданий"
              value={g.effects}
              items={[
                ['low', 'Low'],
                ['medium', 'Medium'],
                ['high', 'High'],
              ]}
              onChange={(v) => field('graphics', 'effects', v)}
            />
            <Choice
              label="Ambient Occlusion"
              value={g.ao}
              items={[
                ['off', 'Выключено'],
                ['contact', 'Контактные тени'],
                ['ssao', 'SSAO · повышенная нагрузка', !props.capabilities.ssao],
              ]}
              onChange={(v) => field('graphics', 'ao', v)}
            />
            <Toggle
              label="Отражения окружения"
              hint="Предварительно отфильтрованное IBL · без экранных отражений"
              value={g.reflections}
              onChange={(v) => field('graphics', 'reflections', v)}
            />
            <Toggle
              label="Bloom"
              hint={
                props.capabilities.bloom
                  ? 'Сдержанное свечение ярких элементов'
                  : 'HDR-буфер не поддерживается этим устройством'
              }
              value={g.bloom}
              disabled={!props.capabilities.bloom}
              onChange={(v) => field('graphics', 'bloom', v)}
            />
            {g.bloom && props.capabilities.bloom && (
              <Slider
                label="Сила Bloom"
                value={g.bloomStrength}
                max={0.4}
                onChange={(v) => field('graphics', 'bloomStrength', v)}
              />
            )}
            <Choice
              label="Лимит FPS"
              hint="Ограничивает только рендеринг. Сетевая симуляция не меняется."
              value={g.fpsLimit}
              items={[
                [0, 'Без ограничения'],
                [30, '30'],
                [60, '60'],
                [120, '120'],
                [144, '144'],
                [240, '240'],
              ]}
              onChange={(v) => field('graphics', 'fpsLimit', v)}
            />
            <Slider
              label="Поле зрения"
              value={g.fov}
              min={60}
              max={105}
              step={1}
              suffix="°"
              onChange={(v) => field('graphics', 'fov', v)}
            />
            <Toggle
              label="Покачивание камеры"
              value={g.headBob}
              onChange={(v) => field('graphics', 'headBob', v)}
            />
            <Row label="Полный экран">
              <button className="fz-quiet" onClick={props.onFullscreen}>
                Переключить
              </button>
            </Row>
            <p className="fz-explanation">
              Motion Blur и временное сглаживание не используются. Изменения применяются без
              перезапуска матча. SSAO и Bloom требуют совместимого HDR-буфера.
            </p>
          </>
        )}
        {tab === 'audio' && (
          <>
            <p className="fz-explanation">
              Громкость и прицел доступны для предварительного просмотра сразу. Остальные изменения
              применяются кнопкой ниже.
            </p>
            {(
              ['master', 'music', 'weapons', 'footsteps', 'effects', 'ui', 'environment'] as const
            ).map((name, i) => (
              <Slider
                key={name}
                label={
                  [
                    'Общая громкость',
                    'Музыка',
                    'Оружие',
                    'Шаги',
                    'Эффекты',
                    'Интерфейс',
                    'Окружение',
                  ][i]
                }
                hint={
                  name === 'music' ? 'Только в главном меню · в матче музыка отключена' : undefined
                }
                value={draft.audio[name]}
                onChange={(v) => field('audio', name, v)}
              />
            ))}
            <Toggle
              label="Отключить весь звук"
              value={draft.audio.muted}
              onChange={(v) => field('audio', 'muted', v)}
            />
            <button className="fz-quiet" onClick={props.onTestAudio}>
              <Volume2 size={16} /> Проверить звук
            </button>
          </>
        )}
      </section>
      <footer className="fz-settings-footer">
        <div>
          <span className={'fz-sync fz-sync-' + sync.status}>
            {sync.status === 'cloud' && <Check size={13} />}
            {syncText}
          </span>
          {!sync.cacheAvailable && (
            <small>Хранилище браузера недоступно. Локальная копия не сохранена.</small>
          )}
          {message && <small role="status">{message}</small>}
          {sync.status === 'local' && (
            <button className="fz-retry" onClick={props.onRetry}>
              Повторить
            </button>
          )}
        </div>
        <button className="fz-quiet" onClick={close}>
          Назад
        </button>
        <button
          className="forge-primary"
          onClick={apply}
          disabled={sync.status === 'account-changed'}
        >
          Применить{dirty ? ' •' : ''}
        </button>
      </footer>
      {sync.conflict && (
        <div className="fz-conflict-banner" role="status">
          <strong>Настройки изменились на другом устройстве.</strong>
          <span>Выберите версию. Автоматической перезаписи не будет.</span>
          <button
            onClick={() => {
              setDraft(structuredClone(sync.conflict!.settings));
              setBase(sync.conflict!.settings);
              props.onUseCloud();
              onPreview(null);
            }}
          >
            Загрузить из аккаунта
          </button>
          <button
            onClick={() => {
              props.onKeepLocal(draft);
              onPreview(null);
            }}
          >
            Сохранить мои
          </button>
        </div>
      )}
      {(capture || conflict || confirm) && (
        <div className="fz-modal-shade">
          <dialog
            open
            className="fz-settings-modal"
            aria-label={
              capture ? 'Ожидание ввода' : conflict ? 'Конфликт назначений' : 'Подтверждение'
            }
          >
            {capture ? (
              <>
                <span className="forge-kicker">INPUT / WAITING</span>
                <h2>{forgeActionText[capture.action]}</h2>
                <p>
                  {capture.kind === 'key'
                    ? 'Нажмите клавишу или кнопку мыши.'
                    : 'Отпустите кнопки, затем нажмите новую кнопку геймпада.'}
                </p>
                <p>Esc / Menu / Options — отмена</p>
                <button data-cancel-capture onClick={() => setCapture(null)}>
                  Отменить назначение
                </button>
              </>
            ) : conflict ? (
              <>
                <span className="forge-kicker">BINDING CONFLICT</span>
                <h2>Кнопка уже занята</h2>
                <p>
                  «{forgeActionText[conflict.other]}» использует{' '}
                  {conflict.kind === 'key'
                    ? forgeBindingLabel(conflict.binding)
                    : labelPad(conflict.binding)}
                  . Поменять назначения местами?
                </p>
                <button className="forge-primary" onClick={swap}>
                  Поменять местами
                </button>
                <button data-close-dialog onClick={() => setConflict(null)}>
                  Отмена
                </button>
              </>
            ) : (
              <>
                <h2>{confirm === 'discard' ? 'Отменить изменения?' : 'Сбросить раздел?'}</h2>
                <p>
                  {confirm === 'discard'
                    ? 'Неприменённые изменения будут отменены.'
                    : 'Остальные разделы сохранят свои настройки.'}
                </p>
                <button
                  className="forge-primary"
                  onClick={() => {
                    if (confirm === 'discard') {
                      onPreview(null);
                      props.onClose();
                    } else {
                      const value = structuredClone(defaultForgeSettings[tab]);
                      update(tab, value);
                    }
                    setConfirm(null);
                  }}
                >
                  {confirm === 'discard' ? 'Выйти без изменений' : 'Сбросить'}
                </button>
                <button data-close-dialog onClick={() => setConfirm(null)}>
                  Отмена
                </button>
              </>
            )}
          </dialog>
        </div>
      )}
      <span className="fz-menu-hint">
        <ChevronLeft size={12} /> LB / RB · вкладки <ChevronRight size={12} />
      </span>
    </dialog>
  );
}
