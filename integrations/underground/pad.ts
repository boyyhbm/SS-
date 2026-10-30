import {
  controllerConfigSchema,
  defaultConfig,
  normalize,
  type ControllerConfig,
  type InputAction,
} from '../../src/input/profiles';
let config: ControllerConfig | null = null;
export function setPadPreferences(value: unknown) {
  const parsed = controllerConfigSchema.safeParse(value);
  config = parsed.success ? parsed.data : null;
}
export function padPreferences() {
  return config ?? defaultConfig();
}
export function remapGamepad(g: Gamepad): Gamepad {
  if (!config) return g;
  const c = config;
  const values = normalize(g, c);
  const actions: (InputAction | null)[] = [
    'confirm',
    'cancel',
    'handbrake',
    'library',
    'previousSection',
    'nextSection',
    'brake',
    'accelerate',
    null,
    'pause',
    null,
    null,
    'navUp',
    'navDown',
    'navLeft',
    'navRight',
    null,
  ];
  const buttons = actions.map((action, index) => {
    const value = action
      ? Math.max(0, Math.min(1, values[action]))
      : (g.buttons[index]?.value ?? 0);
    return { value, pressed: value > 0.5, touched: value > 0 };
  });
  const axes = [values.steer, values.moveY, values.lookX, values.lookY];
  return {
    id: g.id,
    index: g.index,
    mapping: g.mapping,
    connected: g.connected,
    timestamp: g.timestamp,
    axes,
    buttons,
    vibrationActuator: g.vibrationActuator,
    // A read-only view for the mailbox mapper, not a browser-created Gamepad instance.
  } as unknown as Gamepad;
}
