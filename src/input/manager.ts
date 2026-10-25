import {
  actions,
  buttonLabel,
  defaultConfig,
  detectLayout,
  deviceKey,
  normalize,
  type ControllerConfig,
  type ControllerLayout,
  type InputAction,
  type InputBinding,
  type InputMethod,
} from './profiles';
export interface DeviceInfo {
  index: number;
  id: string;
  key: string;
  mapping: string;
  layout: ControllerLayout;
  haptics: boolean;
  armed: boolean;
}
export interface InputSnapshot {
  method: InputMethod;
  devices: DeviceInfo[];
  activeIndex: number | null;
  layout: ControllerLayout;
  config: ControllerConfig;
  revision: number;
  supported: boolean;
}
export type InputEvent =
  | { type: 'connected' | 'disconnected'; device: DeviceInfo; active: boolean }
  | { type: 'frame'; values: Record<InputAction, number>; pad: Gamepad | null; time: number }
  | { type: 'capture'; binding: InputBinding }
  | { type: 'captureCancelled' };
type RumblePad = Omit<Gamepad, 'vibrationActuator' | 'hapticActuators'> & {
  vibrationActuator?: {
    playEffect?: (type: string, options: Record<string, number>) => Promise<unknown>;
    reset?: () => Promise<unknown>;
  };
  hapticActuators?: readonly {
    pulse?: (intensity: number, duration: number) => Promise<unknown>;
  }[];
};
const zero = () => Object.fromEntries(actions.map((a) => [a, 0])) as Record<InputAction, number>;
const serverSnapshot: InputSnapshot = {
  method: 'keyboard',
  devices: [],
  activeIndex: null,
  layout: 'generic',
  config: defaultConfig(),
  revision: 0,
  supported: false,
};
export class NexusInputManager {
  getServerSnapshot = () => serverSnapshot;
  private state: InputSnapshot = {
    method: 'keyboard',
    devices: [],
    activeIndex: null,
    layout: 'generic',
    config: defaultConfig(),
    revision: 0,
    supported: false,
  };
  private subscribers = new Set<() => void>();
  private events = new Set<(event: InputEvent) => void>();
  private keys = new Set<string>();
  private virtual = zero();
  private values = zero();
  private previous = zero();
  private edges = zero();
  private edgeScopes = new Map<InputAction, 'game' | 'ui' | 'capture'>();
  private consumers = new Map<string, number>();
  private frame = 0;
  private lastSampleTime = 0;
  private clients = 0;
  private pad: Gamepad | null = null;
  private known = new Map<number, DeviceInfo>();
  private unarmed = new Set<number>();
  private scopes = new Map<symbol, 'game' | 'ui' | 'capture'>();
  private capturing: InputAction | null = null;
  private captureBaseline: number[] = [];
  private captureArmed = false;
  private suppressUntilNeutral = false;
  private hapticTimes = new Map<string, number>();
  private suppressedHaptic = new Set<number>();
  private assignments = new Map<number, number>();
  private lost = false;
  private chosenIndex: number | null = null;
  private physical = new Map<number, Gamepad>();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };
  on = (fn: (event: InputEvent) => void) => {
    this.events.add(fn);
    return () => {
      this.events.delete(fn);
    };
  };
  private publish() {
    this.state = { ...this.state, revision: this.state.revision + 1 };
    this.subscribers.forEach((fn) => fn());
  }
  private emit(event: InputEvent) {
    this.events.forEach((fn) => fn(event));
  }
  get scope() {
    if (this.capturing) return 'capture';
    return [...this.scopes.values()].includes('capture')
      ? 'capture'
      : [...this.scopes.values()].includes('game')
        ? 'game'
        : 'ui';
  }
  acquire(scope: 'game' | 'ui' | 'capture') {
    const key = Symbol(scope);
    this.scopes.set(key, scope);
    return () => {
      this.scopes.delete(key);
    };
  }
  setConfig(config: ControllerConfig) {
    if (!config.vibrationEnabled || config.vibrationIntensity === 0) void this.resetHaptics();
    this.suppressUntilNeutral = true;
    this.state = { ...this.state, config: structuredClone(config) };
    this.updateLayout();
    this.publish();
  }
  setMethod(method: InputMethod) {
    if (this.state.method !== method) {
      this.state = { ...this.state, method };
      this.publish();
    }
  }
  setActive(index: number) {
    if (!this.known.has(index)) return;
    this.chosenIndex = index;
    this.state = { ...this.state, activeIndex: index };
    this.assignments.set(0, index);
    this.lost = false;
    this.previous = zero();
    this.updateLayout();
    this.publish();
  }
  assignDevice(index: number, player: number) {
    if (player < 0 || player > 3 || !this.known.has(index)) return;
    for (const [slot, value] of this.assignments)
      if (value === index) this.assignments.delete(slot);
    this.assignments.set(player, index);
    if (player === 0) this.setActive(index);
  }
  assignedDevice(player = 0) {
    return this.assignments.get(player) ?? null;
  }
  raw() {
    return this.pad;
  }
  read() {
    return this.lost ? zero() : this.values;
  }
  // Game simulation may tick while GPU presentation waits for a frame. Sampling
  // here never schedules another RAF and never sends raw device data to a server.
  readFresh() {
    if (this.clients > 0) this.sample(performance.now());
    return this.read();
  }
  setVirtual(action: InputAction, value: number, method: 'touch' | 'mouse' = 'touch') {
    this.virtual[action] = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    if (this.virtual[action] !== 0) {
      this.lost = false;
      this.setMethod(method);
    }
  }
  clearVirtual() {
    this.virtual = zero();
  }
  readPlayer(player = 0) {
    if (player === 0) return this.read();
    const index = this.assignments.get(player);
    const pad = index === undefined ? undefined : this.physical.get(index);
    return pad && !this.unarmed.has(pad.index) ? normalize(pad, this.state.config) : zero();
  }
  private padNeutral(pad: Gamepad) {
    const value = normalize(pad, this.state.config);
    return (
      pad.buttons.every((button) => button.value < 0.2) &&
      ['moveX', 'moveY', 'lookX', 'lookY', 'steer', 'accelerate', 'brake'].every(
        (action) => Math.abs(value[action as InputAction]) < 0.2,
      )
    );
  }
  isNeutral() {
    return !this.pad || this.padNeutral(this.pad);
  }
  consume(action: InputAction, consumer: string, scope: 'game' | 'ui' | 'capture' = 'game') {
    const key = `${consumer}:${action}`;
    const edge = this.edges[action];
    if ((this.consumers.get(key) ?? 0) === edge) return false;
    this.consumers.set(key, edge);
    return this.edgeScopes.get(action) === scope;
  }
  label(action: InputAction) {
    const config = this.state.config;
    const bindings =
      config.layout === 'auto' && this.state.layout === 'nintendo'
        ? defaultConfig('nintendo').bindings
        : config.bindings;
    let binding = bindings[action];
    if (config.swapConfirmCancel && (action === 'confirm' || action === 'cancel'))
      binding = bindings[action === 'confirm' ? 'cancel' : 'confirm'];
    return buttonLabel(binding, this.state.layout);
  }
  capture(action: InputAction | null) {
    this.capturing = action;
    this.captureArmed = false;
    this.captureBaseline = [...(this.pad?.axes ?? [])];
  }
  private updateLayout() {
    const info = this.state.devices.find((d) => d.index === this.state.activeIndex);
    this.state = {
      ...this.state,
      layout:
        this.state.config.layout === 'auto'
          ? (info?.layout ?? 'generic')
          : this.state.config.layout,
    };
  }
  start() {
    this.clients++;
    if (this.clients > 1) return () => this.stop();
    this.state = {
      ...this.state,
      supported: typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function',
    };
    this.publish();
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('pointerdown', this.pointer);
    window.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.visibility);
    this.frame = requestAnimationFrame(this.poll);
    return () => this.stop();
  }
  private stop() {
    if (--this.clients > 0) return;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointerdown', this.pointer);
    window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('visibilitychange', this.visibility);
    this.clearKeys();
  }
  private keyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && this.capturing) {
      this.capturing = null;
      this.emit({ type: 'captureCancelled' });
      return;
    }
    if (!event.repeat && this.scope === 'game') {
      if (event.code === 'Escape') {
        this.edges.pause++;
        this.edgeScopes.set('pause', 'game');
      }
      if (event.code === 'KeyC') {
        this.edges.camera++;
        this.edgeScopes.set('camera', 'game');
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code))
        event.preventDefault();
    }
    this.setMethod('keyboard');
    this.lost = false;
    if (
      !(event.target instanceof HTMLElement) ||
      !event.target.matches('input,textarea,select,[contenteditable="true"]')
    )
      this.keys.add(event.code);
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private pointer = (event: PointerEvent) => {
    this.setMethod(event.pointerType === 'touch' ? 'touch' : 'mouse');
  };
  private pointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && Math.abs(event.movementX) + Math.abs(event.movementY) > 2)
      this.setMethod('mouse');
  };
  private clearKeys = () => {
    this.keys.clear();
    this.clearVirtual();
    this.values = zero();
  };
  private visibility = () => {
    if (document.hidden) {
      this.clearKeys();
      void this.resetHaptics();
    }
  };
  private poll = (time: number) => {
    this.sample(time);
    this.frame = requestAnimationFrame(this.poll);
  };
  private sample(time: number) {
    // RAF's presentation timestamp can trail an intervening simulation tick.
    time = Math.max(time, this.lastSampleTime);
    this.lastSampleTime = time;
    let pads: (Gamepad | null)[] = [];
    try {
      pads = [...(navigator.getGamepads?.() ?? [])];
    } catch {
      /* Permissions Policy / browser without access. */
    }
    const connected = pads.filter((pad): pad is Gamepad => !!pad?.connected);
    this.physical = new Map(connected.map((pad) => [pad.index, pad]));
    let changed = false;
    for (const pad of connected) {
      const prior = this.known.get(pad.index);
      if (prior && prior.key !== deviceKey(pad.id, pad.mapping)) {
        const active = pad.index === this.state.activeIndex;
        this.known.delete(pad.index);
        this.suppressedHaptic.delete(pad.index);
        if (active) {
          this.lost = this.state.method === 'gamepad';
          this.values = zero();
          this.previous = zero();
        }
        this.emit({ type: 'disconnected', device: prior, active });
      }
      if (!this.known.has(pad.index)) {
        const device: DeviceInfo = {
          index: pad.index,
          id: pad.id.slice(0, 256),
          key: deviceKey(pad.id, pad.mapping),
          mapping: pad.mapping,
          layout: detectLayout(pad.id, pad.mapping),
          haptics: this.hasHaptics(pad),
          armed: false,
        };
        this.known.set(pad.index, device);
        this.unarmed.add(pad.index);
        changed = true;
        this.emit({
          type: 'connected',
          device,
          active: this.state.activeIndex === null || this.state.activeIndex === pad.index,
        });
      }
      if (this.unarmed.has(pad.index) && this.padNeutral(pad)) {
        this.unarmed.delete(pad.index);
        const d = this.known.get(pad.index)!;
        d.armed = true;
        changed = true;
      }
    }
    for (const [index, device] of this.known)
      if (!connected.some((p) => p.index === index)) {
        const active = index === this.state.activeIndex;
        this.known.delete(index);
        this.unarmed.delete(index);
        this.suppressedHaptic.delete(index);
        for (const [player, assigned] of this.assignments)
          if (assigned === index) this.assignments.delete(player);
        changed = true;
        if (active) {
          this.lost = this.state.method === 'gamepad';
          this.values = zero();
          this.previous = zero();
          this.pad = null;
          this.chosenIndex = null;
          this.state = { ...this.state, activeIndex: null };
        }
        this.emit({ type: 'disconnected', device, active });
      }
    if (changed) {
      this.state = { ...this.state, devices: [...this.known.values()] };
      if (this.state.activeIndex === null && connected.length) {
        this.state = { ...this.state, activeIndex: connected[0].index };
        this.assignments.set(0, connected[0].index);
        // A newly discovered neutral pad was already armed above. Rearming it
        // here would discard the user's first press until another full release.
        if (this.lost && !this.padNeutral(connected[0])) {
          this.unarmed.add(connected[0].index);
          this.known.get(connected[0].index)!.armed = false;
        }
      }
      this.updateLayout();
      this.publish();
    }
    this.pad = connected.find((p) => p.index === this.state.activeIndex) ?? null;
    if (!document.hidden) {
      let values = zero();
      const activity = (pad: Gamepad) =>
        pad.buttons.some((b) => b.value > 0.2) ||
        pad.axes.some((a, i) => i < 4 && Math.abs(a) > 0.35);
      const candidate = connected.find((p) => activity(p) && !this.unarmed.has(p.index));
      if (candidate && this.chosenIndex === null && candidate.index !== this.state.activeIndex) {
        this.state = { ...this.state, activeIndex: candidate.index };
        this.pad = candidate;
        this.updateLayout();
        this.publish();
      }
      if (this.pad && !this.unarmed.has(this.pad.index)) {
        const normalized = normalize(this.pad, this.state.config);
        // Only meaningful changes claim the input method. A held stick cannot steal it back from a mouse.
        if (
          actions.some((a) => Math.abs(normalized[a] - this.previous[a]) > 0.2) &&
          activity(this.pad)
        ) {
          this.setMethod('gamepad');
          this.lost = false;
        }
        values = normalized;
      }
      if (this.capturing && this.pad) {
        if (this.pad.buttons.every((b) => b.value < 0.2)) this.captureArmed = true;
        const button = this.pad.buttons.findIndex(
          (b, i) => b.value > 0.65 && !this.previousButtonDown(i),
        );
        const axis = this.pad.axes.findIndex(
          (v, i) => Math.abs(v - (this.captureBaseline[i] ?? 0)) > 0.65,
        );
        if (this.captureArmed && (button >= 0 || axis >= 0)) {
          const cancel = this.state.config.bindings.cancel;
          if (button >= 0 && cancel.kind === 'button' && button === cancel.index) {
            this.capturing = null;
            this.emit({ type: 'captureCancelled' });
          } else {
            const binding: InputBinding =
              button >= 0
                ? { kind: 'button', index: button }
                : {
                    kind: 'axis',
                    index: axis,
                    sign: this.pad.axes[axis] >= 0 ? 1 : -1,
                    mode: 'signed',
                  };
            this.capturing = null;
            this.emit({ type: 'capture', binding });
          }
          this.suppressUntilNeutral = true;
        }
      }
      if (this.suppressUntilNeutral) {
        if (this.isNeutral()) this.suppressUntilNeutral = false;
        values = zero();
      }

      for (const action of actions)
        if (values[action] > 0.5 && this.previous[action] <= 0.5) {
          this.edges[action]++;
          this.edgeScopes.set(action, this.scope);
        }
      this.previous = { ...values };
      this.previousButtons = this.pad?.buttons.map((b) => b.value > 0.5) ?? [];
      const keyboard = zero();
      keyboard.accelerate = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
      keyboard.brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
      keyboard.steer =
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      keyboard.boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0;
      keyboard.handbrake = this.keys.has('Space') ? 1 : 0;
      keyboard.moveX = keyboard.steer;
      keyboard.moveY = keyboard.brake - keyboard.accelerate;
      keyboard.jump = this.keys.has('Space') ? 1 : 0;
      keyboard.interact = this.keys.has('KeyE') ? 1 : 0;
      this.values = this.lost
        ? zero()
        : (Object.fromEntries(
            actions.map((a) => [
              a,
              [values[a], keyboard[a], this.virtual[a]].reduce(
                (best, v) => (Math.abs(v) > Math.abs(best) ? v : best),
                0,
              ),
            ]),
          ) as Record<InputAction, number>);
      this.emit({ type: 'frame', values: this.lost ? zero() : values, pad: this.pad, time });
    } else this.values = zero();
  }
  private previousButtons: boolean[] = [];
  private previousButtonDown(index: number) {
    return this.previousButtons[index] ?? false;
  }
  private hasHaptics(pad: Gamepad) {
    const p = pad as RumblePad;
    return !!(p.vibrationActuator?.playEffect || p.hapticActuators?.[0]?.pulse);
  }
  async resetHaptics() {
    try {
      await (this.pad as RumblePad | null)?.vibrationActuator?.reset?.();
    } catch {
      /* Optional actuator. */
    }
  }
  async haptic(
    event: 'confirm' | 'collision' | 'accelerate' | 'boost' | 'start' | 'finish' | 'test',
  ) {
    const pad = this.pad as RumblePad | null,
      config = this.state.config;
    if (
      !pad ||
      !config.vibrationEnabled ||
      config.vibrationIntensity === 0 ||
      this.suppressedHaptic.has(pad.index)
    )
      return false;
    const now = performance.now();
    if (
      event !== 'test' &&
      now - (this.hapticTimes.get(event) ?? -1000) <
        (event === 'collision' ? 180 : event === 'boost' ? 250 : event === 'accelerate' ? 500 : 120)
    )
      return false;
    if (event !== 'collision' && now - (this.hapticTimes.get('collision') ?? -1000) < 160)
      return false;
    this.hapticTimes.set(event, now);
    const patterns = {
      confirm: [25, 0.08, 0.15],
      collision: [100, 0.85, 0.7],
      accelerate: [35, 0.04, 0.1],
      boost: [100, 0.18, 0.45],
      start: [180, 0.3, 0.45],
      finish: [240, 0.5, 0.7],
      test: [250, 0.5, 0.5],
    };
    const [duration, strong, weak] = patterns[event];
    try {
      if (pad.vibrationActuator?.playEffect)
        await pad.vibrationActuator.playEffect('dual-rumble', {
          duration,
          startDelay: 0,
          strongMagnitude: strong * config.vibrationIntensity,
          weakMagnitude: weak * config.vibrationIntensity,
        });
      else if (pad.hapticActuators?.[0]?.pulse)
        await pad.hapticActuators[0].pulse(strong * config.vibrationIntensity, duration);
      else return false;
      return true;
    } catch {
      this.suppressedHaptic.add(pad.index);
      const d = this.known.get(pad.index);
      if (d) d.haptics = false;
      this.state = { ...this.state, devices: [...this.known.values()] };
      this.publish();
      return false;
    }
  }
}
export const nexusInput = new NexusInputManager();
