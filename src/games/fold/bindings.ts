import {
  defaultConfig,
  detectLayout,
  type ControllerConfig,
  type InputBinding,
  type RawController,
} from '@/input/profiles';
import {
  bindingId,
  defaultForgeSettings,
  forgeActions,
  type ForgeAction,
  type ForgeBinding,
  type ForgePadBinding,
  type ForgePadAction,
  type ForgeSettings,
} from './settings';

export const forgeActionText: Record<ForgeAction, string> = {
  forward: 'Вперёд',
  backward: 'Назад',
  left: 'Влево',
  right: 'Вправо',
  jump: 'Прыжок',
  sprint: 'Спринт',
  slide: 'Скольжение',
  fire: 'Огонь',
  aim: 'Прицеливание',
  reload: 'Перезарядка',
  fold: 'Активировать FOLD',
  interact: 'Взаимодействие с FOLD',
  impulse: 'Импульс',
  menu: 'Меню',
  scoreboard: 'Таблица счёта',
};
export function forgeBindingLabel(b: ForgeBinding) {
  if (b.kind === 'mouse') return ['ЛКМ', 'СКМ', 'ПКМ', 'Мышь 4', 'Мышь 5'][b.button];
  return (
    (
      {
        Space: 'Пробел',
        Escape: 'Esc',
        ShiftLeft: 'L Shift',
        ShiftRight: 'R Shift',
        ControlLeft: 'L Ctrl',
        ControlRight: 'R Ctrl',
        AltLeft: 'L Alt',
        AltRight: 'R Alt',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      } as Record<string, string>
    )[b.code] ?? b.code.replace(/^Key|^Digit/, '')
  );
}
export function bindingConflict(
  map: ForgeSettings['keys'],
  action: ForgeAction,
  binding: ForgeBinding,
) {
  return forgeActions.find((a) => a !== action && bindingId(map[a]) === bindingId(binding)) ?? null;
}
export function assignForgeBinding(
  map: ForgeSettings['keys'],
  action: ForgeAction,
  binding: ForgeBinding,
  swap: boolean,
) {
  if (binding.kind === 'key' && binding.code === 'Escape' && action !== 'menu')
    throw Error('escapeReserved');
  const conflict = bindingConflict(map, action, binding);
  if (conflict && !swap) throw Error('bindingConflict');
  if (conflict && map[action].kind === 'key' && map[action].code === 'Escape')
    throw Error('reservedSwap');
  const next = { ...map, [action]: binding };
  if (conflict) next[conflict] = map[action];
  return next;
}
export function resetForgeBinding(map: ForgeSettings['keys'], action: ForgeAction) {
  return assignForgeBinding(map, action, defaultForgeSettings.keys[action], true);
}
export function resolvePadBinding(
  b: ForgePadBinding,
  config: ControllerConfig,
  pad?: Pick<RawController, 'id' | 'mapping'> | null,
): InputBinding {
  if (b.kind !== 'platform') return b;
  const source =
    config.layout === 'auto' && pad && detectLayout(pad.id, pad.mapping) === 'nintendo'
      ? defaultConfig('nintendo')
      : config;
  return source.bindings[b.action];
}
export const padBindingId = (b: InputBinding) =>
  b.kind === 'button' ? 'button:' + b.index : `axis:${b.index}:${b.sign}:${b.mode}`;
export const padPreferenceId = (b: ForgePadBinding) =>
  b.kind === 'platform' ? 'platform:' + b.action : padBindingId(b);
export function padConflict(
  map: ForgeSettings['controller']['bindings'],
  action: ForgePadAction,
  binding: ForgePadBinding,
  config: ControllerConfig,
  pad?: Pick<RawController, 'id' | 'mapping'> | null,
) {
  const target = padBindingId(resolvePadBinding(binding, config, pad));
  return (
    (Object.keys(map) as ForgePadAction[]).find(
      (a) => a !== action && padBindingId(resolvePadBinding(map[a], config, pad)) === target,
    ) ?? null
  );
}
