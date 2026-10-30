import { z } from 'zod';
import { actions, bindingSchema as platformBindingSchema } from '@/input/profiles';

export const forgeActions = [
  'forward',
  'backward',
  'left',
  'right',
  'jump',
  'sprint',
  'slide',
  'fire',
  'aim',
  'reload',
  'fold',
  'interact',
  'impulse',
  'menu',
  'scoreboard',
] as const;
export type ForgeAction = (typeof forgeActions)[number];
export const padActions = [
  'jump',
  'sprint',
  'slide',
  'fire',
  'aim',
  'reload',
  'fold',
  'interact',
  'impulse',
  'menu',
  'scoreboard',
] as const;
export type ForgePadAction = (typeof padActions)[number];
const keyCode =
  /^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(?:Up|Down|Left|Right)|(?:Shift|Control|Alt)(?:Left|Right)|Space|Tab|Escape|Enter|Backspace|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Delete|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-9]|2[0-4]))$/;
export const forgeBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('key'), code: z.string().max(24).regex(keyCode) }).strict(),
  z.object({ kind: z.literal('mouse'), button: z.number().int().min(0).max(4) }).strict(),
]);
export type ForgeBinding = z.infer<typeof forgeBindingSchema>;
export const forgePadBindingSchema = z.union([
  platformBindingSchema,
  z.object({ kind: z.literal('platform'), action: z.enum(actions) }).strict(),
]);
export type ForgePadBinding = z.infer<typeof forgePadBindingSchema>;
export const bindingId = (binding: ForgeBinding) =>
  binding.kind === 'key' ? 'key:' + binding.code : 'mouse:' + binding.button;
const keysSchema = z.record(z.enum(forgeActions), forgeBindingSchema).superRefine((map, ctx) => {
  const seen = new Set<string>();
  for (const action of forgeActions) {
    const b = map[action],
      id = bindingId(b);
    if (seen.has(id)) ctx.addIssue({ code: 'custom', message: 'bindingConflict', path: [action] });
    if (action !== 'menu' && b.kind === 'key' && b.code === 'Escape')
      ctx.addIssue({ code: 'custom', message: 'escapeReserved', path: [action] });
    seen.add(id);
  }
});
const volume = z.number().finite().min(0).max(1);
export const forgeSettingsSchema = z
  .object({
    version: z.literal(2),
    keys: keysSchema,
    mouse: z
      .object({
        sensitivity: z.number().finite().min(0.1).max(5),
        x: z.number().finite().min(0.1).max(3),
        y: z.number().finite().min(0.1).max(3),
        ads: z.number().finite().min(0.1).max(2),
        invertY: z.boolean(),
        rawInput: z.boolean(),
      })
      .strict(),
    controller: z
      .object({
        x: z.number().finite().min(0.2).max(3),
        y: z.number().finite().min(0.2).max(3),
        leftDeadzone: z.number().finite().min(0).max(0.45),
        rightDeadzone: z.number().finite().min(0).max(0.45),
        curve: z.enum(['linear', 'dynamic', 'precision']),
        precisionExponent: z.number().finite().min(1).max(2.5),
        ads: z.number().finite().min(0.1).max(2),
        invertY: z.boolean(),
        vibration: z.boolean(),
        vibrationIntensity: volume,
        bindings: z.record(z.enum(padActions), forgePadBindingSchema),
      })
      .strict(),
    crosshair: z
      .object({
        color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
        size: z.number().int().min(2).max(20),
        thickness: z.number().int().min(1).max(5),
        opacity: volume,
        gap: z.number().int().min(0).max(16),
        outline: z.boolean(),
        dot: z.boolean(),
        dynamic: z.boolean(),
      })
      .strict(),
    graphics: z
      .object({
        quality: z.enum(['auto', 'competitive', 'low', 'medium', 'high', 'ultra']),
        renderScale: z.number().finite().min(0.5).max(1.3),
        texture: z.enum(['low', 'medium', 'high']),
        shadows: z.enum(['preset', 'off', 'low', 'medium', 'high']),
        aa: z.enum(['msaa', 'fxaa', 'off']),
        effects: z.enum(['low', 'medium', 'high']),
        ao: z.enum(['off', 'contact', 'ssao']),
        reflections: z.boolean(),
        bloom: z.boolean(),
        bloomStrength: z.number().finite().min(0).max(0.4),
        fpsLimit: z.union([
          z.literal(0),
          z.literal(30),
          z.literal(60),
          z.literal(120),
          z.literal(144),
          z.literal(240),
        ]),
        fov: z.number().int().min(60).max(105),
        headBob: z.boolean(),
      })
      .strict(),
    audio: z
      .object({
        master: volume,
        music: volume,
        effects: volume,
        weapons: volume,
        footsteps: volume,
        ui: volume,
        environment: volume,
        muted: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ForgeSettings = z.infer<typeof forgeSettingsSchema>;
const key = (code: string): ForgeBinding => ({ kind: 'key', code });
const platform = (action: (typeof actions)[number]): ForgePadBinding => ({
  kind: 'platform',
  action,
});
export const defaultForgeSettings: ForgeSettings = {
  version: 2,
  keys: {
    forward: key('KeyW'),
    backward: key('KeyS'),
    left: key('KeyA'),
    right: key('KeyD'),
    jump: key('Space'),
    sprint: key('ShiftLeft'),
    slide: key('ControlLeft'),
    fire: { kind: 'mouse', button: 0 },
    aim: { kind: 'mouse', button: 2 },
    reload: key('KeyR'),
    fold: key('KeyF'),
    interact: key('KeyE'),
    impulse: key('KeyQ'),
    menu: key('Escape'),
    scoreboard: key('Tab'),
  },
  mouse: { sensitivity: 1, x: 1, y: 1, ads: 0.75, invertY: false, rawInput: false },
  controller: {
    x: 1,
    y: 1,
    leftDeadzone: 0.15,
    rightDeadzone: 0.15,
    curve: 'precision',
    precisionExponent: 1.5,
    ads: 0.75,
    invertY: false,
    vibration: true,
    vibrationIntensity: 0.55,
    bindings: {
      jump: platform('jump'),
      sprint: { kind: 'button', index: 10 },
      slide: platform('camera'),
      fire: platform('accelerate'),
      aim: platform('brake'),
      reload: platform('handbrake'),
      fold: platform('nextSection'),
      interact: { kind: 'button', index: 3 },
      impulse: platform('previousSection'),
      menu: platform('pause'),
      scoreboard: { kind: 'button', index: 8 },
    },
  },
  crosshair: {
    color: '#f4f2ea',
    size: 7,
    thickness: 2,
    opacity: 1,
    gap: 4,
    outline: true,
    dot: false,
    dynamic: false,
  },
  graphics: {
    quality: 'auto',
    renderScale: 1,
    texture: 'high',
    shadows: 'preset',
    aa: 'msaa',
    effects: 'high',
    ao: 'contact',
    reflections: true,
    bloom: false,
    bloomStrength: 0.12,
    fpsLimit: 0,
    fov: 76,
    headBob: false,
  },
  audio: {
    master: 0.65,
    music: 0.18,
    effects: 0.7,
    weapons: 0.8,
    footsteps: 0.65,
    ui: 0.5,
    environment: 0.4,
    muted: false,
  },
};
export const legacyForgeSettingsSchema = z
  .object({
    quality: z.enum(['auto', 'competitive', 'low', 'medium', 'high', 'ultra']),
    mouseSensitivity: z.number().finite().min(0.1).max(3),
    aimSensitivity: z.number().finite().min(0.2).max(3),
    responseCurve: z.number().finite().min(1).max(2.5),
    invertY: z.boolean(),
    headBob: z.boolean(),
    master: volume,
    weapons: volume,
    environment: volume,
    effects: volume,
  })
  .strict();
export function migrateForgeSettings(value: unknown): ForgeSettings {
  const current = forgeSettingsSchema.safeParse(value);
  if (current.success) return current.data;
  const old = legacyForgeSettingsSchema.safeParse(value),
    s = structuredClone(defaultForgeSettings);
  if (!old.success) return s;
  s.mouse.sensitivity = old.data.mouseSensitivity;
  s.mouse.invertY = old.data.invertY;
  s.mouse.ads = 1;
  s.controller.x = s.controller.y = old.data.aimSensitivity;
  s.controller.precisionExponent = old.data.responseCurve;
  s.controller.invertY = old.data.invertY;
  s.controller.ads = 1;
  s.graphics.quality = old.data.quality;
  s.graphics.headBob = old.data.headBob;
  Object.assign(s.audio, {
    master: old.data.master,
    weapons: old.data.weapons,
    footsteps: old.data.environment,
    environment: old.data.environment,
    effects: old.data.effects,
  });
  return s;
}
export const forgeSaveSchema = z
  .object({
    version: z.literal(2),
    revision: z.number().int().min(1),
    settings: forgeSettingsSchema,
    updatedAt: z.iso.datetime(),
    lastMutationId: z.uuid(),
  })
  .strict();
export const forgeWriteSchema = z
  .object({
    ownerId: z.string().min(1).max(64),
    expectedRevision: z.number().int().min(0),
    mutationId: z.uuid(),
    settings: forgeSettingsSchema,
  })
  .strict();
export function readForgeSettings(saves: Record<string, unknown>) {
  const saved = forgeSaveSchema.safeParse(saves['forge-settings-v2']);
  return saved.success
    ? saved.data
    : {
        settings: migrateForgeSettings(saves['forge-settings-v1']),
        revision: 0,
        updatedAt: null,
        lastMutationId: null,
      };
}
