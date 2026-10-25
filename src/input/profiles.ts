import { z } from 'zod';
export const actions = [
  'moveX',
  'moveY',
  'lookX',
  'lookY',
  'accelerate',
  'brake',
  'steer',
  'jump',
  'interact',
  'boost',
  'handbrake',
  'camera',
  'pause',
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
] as const;
export type InputAction = (typeof actions)[number];
export type InputMethod = 'keyboard' | 'mouse' | 'touch' | 'gamepad';
export const layouts = ['auto', 'playstation', 'xbox', 'nintendo', 'generic', 'custom'] as const;
export type ControllerLayout = (typeof layouts)[number];
export const bindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('button'), index: z.number().int().min(0).max(63) }).strict(),
  z
    .object({
      kind: z.literal('axis'),
      index: z.number().int().min(0).max(15),
      sign: z.union([z.literal(1), z.literal(-1)]),
      mode: z.enum(['signed', 'positive', 'trigger']),
    })
    .strict(),
]);
export type InputBinding = z.infer<typeof bindingSchema>;
export const controllerConfigSchema = z
  .object({
    layout: z.enum(layouts),
    deadZone: z.number().finite().min(0.02).max(0.45),
    steeringSensitivity: z.number().finite().min(0.35).max(2.5),
    invertSteer: z.boolean(),
    invertMoveY: z.boolean(),
    invertLookY: z.boolean(),
    swapConfirmCancel: z.boolean(),
    vibrationEnabled: z.boolean(),
    vibrationIntensity: z.number().finite().min(0).max(1),
    bindings: z.record(z.enum(actions), bindingSchema),
  })
  .strict();
export type ControllerConfig = z.infer<typeof controllerConfigSchema>;
const button = (index: number): InputBinding => ({ kind: 'button', index });
const axis = (index: number): InputBinding => ({ kind: 'axis', index, sign: 1, mode: 'signed' });
export function defaultConfig(layout: ControllerLayout = 'auto'): ControllerConfig {
  const nintendo = layout === 'nintendo';
  return {
    layout,
    deadZone: 0.15,
    steeringSensitivity: 1,
    invertSteer: false,
    invertMoveY: false,
    invertLookY: false,
    swapConfirmCancel: false,
    vibrationEnabled: true,
    vibrationIntensity: 0.55,
    bindings: {
      moveX: axis(0),
      moveY: axis(1),
      lookX: axis(2),
      lookY: axis(3),
      steer: axis(0),
      accelerate: button(7),
      brake: button(6),
      jump: button(nintendo ? 1 : 0),
      interact: button(2),
      boost: button(nintendo ? 1 : 0),
      handbrake: button(2),
      camera: button(nintendo ? 0 : 1),
      pause: button(9),
      confirm: button(nintendo ? 1 : 0),
      cancel: button(nintendo ? 0 : 1),
      context: button(9),
      previousSection: button(4),
      nextSection: button(5),
      library: button(3),
      navUp: button(12),
      navDown: button(13),
      navLeft: button(14),
      navRight: button(15),
    },
  };
}
export function detectLayout(id: string, mapping: string): Exclude<ControllerLayout, 'auto'> {
  if (/dualsense|dualshock|playstation|054c|sony/i.test(id)) return 'playstation';
  if (/nintendo|switch|057e/i.test(id)) return 'nintendo';
  if (/xbox|xinput|045e|microsoft/i.test(id)) return 'xbox';
  return mapping === 'standard' ? 'generic' : 'custom';
}
export function deviceKey(id: string, mapping: string) {
  let hash = 2166136261;
  for (const char of `${id}|${mapping}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `pad_${(hash >>> 0).toString(16)}`;
}
export const clamp = (n: number, min = -1, max = 1) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
export function deadzone(value: number, zone: number) {
  const v = clamp(value);
  return Math.abs(v) <= zone ? 0 : (Math.sign(v) * (Math.abs(v) - zone)) / (1 - zone);
}
export interface RawController {
  id: string;
  mapping: string;
  index: number;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
}
export function bindingValue(pad: RawController, binding: InputBinding, zone: number) {
  if (binding.kind === 'button') return clamp(pad.buttons[binding.index]?.value ?? 0, 0, 1);
  const raw = clamp(pad.axes[binding.index] ?? 0) * binding.sign;
  return binding.mode === 'trigger'
    ? clamp((raw + 1) / 2, 0, 1)
    : binding.mode === 'positive'
      ? Math.max(0, deadzone(raw, zone))
      : deadzone(raw, zone);
}
export function normalize(
  pad: RawController,
  config: ControllerConfig,
): Record<InputAction, number> {
  const detected = detectLayout(pad.id, pad.mapping);
  // Browser-standard mappings are canonical. Nintendo face labels keep their own confirm convention.
  const bindings =
    config.layout === 'auto' && detected === 'nintendo'
      ? defaultConfig('nintendo').bindings
      : config.bindings;
  const values = Object.fromEntries(
    actions.map((a) => [a, bindingValue(pad, bindings[a], config.deadZone)]),
  ) as Record<InputAction, number>;
  values.steer = clamp(values.steer * config.steeringSensitivity * (config.invertSteer ? -1 : 1));
  values.moveY *= config.invertMoveY ? -1 : 1;
  values.lookY *= config.invertLookY ? -1 : 1;
  if (config.swapConfirmCancel) [values.confirm, values.cancel] = [values.cancel, values.confirm];
  return values;
}
export function buttonLabel(binding: InputBinding, layout: ControllerLayout) {
  if (binding.kind === 'axis')
    return ['LS↔', 'LS↕', 'RS↔', 'RS↕'][binding.index] ?? `AX${binding.index}`;
  if (layout === 'custom') return `B${binding.index}`;
  const labels =
    layout === 'playstation'
      ? [
          '×',
          '○',
          '□',
          '△',
          'L1',
          'R1',
          'L2',
          'R2',
          'Share',
          'Options',
          'L3',
          'R3',
          '↑',
          '↓',
          '←',
          '→',
          'PS',
        ]
      : layout === 'nintendo'
        ? [
            'B',
            'A',
            'Y',
            'X',
            'L',
            'R',
            'ZL',
            'ZR',
            '−',
            '+',
            'LS',
            'RS',
            '↑',
            '↓',
            '←',
            '→',
            'Home',
          ]
        : [
            'A',
            'B',
            'X',
            'Y',
            'LB',
            'RB',
            'LT',
            'RT',
            'View',
            'Menu',
            'LS',
            'RS',
            '↑',
            '↓',
            '←',
            '→',
            'Home',
          ];
  return labels[binding.index] ?? `B${binding.index}`;
}
