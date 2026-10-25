import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig,
  normalize,
  deadzone,
  detectLayout,
  controllerConfigSchema,
  type RawController,
} from '../src/input/profiles';
import { NexusInputManager } from '../src/input/manager';
import { initialRace, stepRace } from '../src/games/racing-physics';
import { inputCommandSchema } from '../src/multiplayer/contracts';
type MutableController = Omit<RawController, 'axes' | 'buttons'> & {
  axes: number[];
  buttons: { value: number; pressed: boolean }[];
};
function raw(id = 'Xbox test', mapping = 'standard'): MutableController {
  return {
    id,
    mapping,
    index: 0,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ value: 0, pressed: false })),
  };
}
function harness() {
  const win = new EventTarget(),
    doc = Object.assign(new EventTarget(), { hidden: false });
  let pads: (RawController | null)[] = [];
  let callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    callbacks.push(fn);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const manager = new NexusInputManager();
  const stop = manager.start();
  let now = 1000;
  return {
    manager,
    win,
    setPads: (next: (RawController | null)[]) => {
      pads = next;
    },
    queuedFrames: () => callbacks.length,
    tick: () => {
      now += 17;
      const queued = callbacks;
      callbacks = [];
      queued.forEach((fn) => fn(now));
    },
    stop,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('controller normalization', () => {
  it('preserves analog trigger pressure and smooth signed steering', () => {
    const p = raw();
    p.buttons[7] = { value: 0.27, pressed: false };
    p.buttons[6] = { value: 0.62, pressed: true };
    p.axes = [0.6, 0, 0, 0];
    const values = normalize(p, defaultConfig());
    expect(values.accelerate).toBe(0.27);
    expect(values.brake).toBe(0.62);
    expect(values.steer).toBeCloseTo((0.6 - 0.15) / 0.85);
  });
  it('rejects stick noise, clamps extremes, applies sensitivity and inversion', () => {
    expect(deadzone(0.09, 0.15)).toBe(0);
    expect(deadzone(-1, 0.15)).toBe(-1);
    const p = raw();
    p.axes = [0.6, 0.6, 0, 0.6];
    const c = {
      ...defaultConfig(),
      steeringSensitivity: 2,
      invertSteer: true,
      invertMoveY: true,
      invertLookY: true,
    };
    const v = normalize(p, c);
    expect(v.steer).toBe(-1);
    expect(v.moveY).toBeLessThan(0);
    expect(v.lookY).toBeLessThan(0);
  });
  it('uses device/layout profiles without asserting physical compatibility', () => {
    expect(detectLayout('DualSense 054c', 'standard')).toBe('playstation');
    expect(detectLayout('Switch Pro 057e', 'standard')).toBe('nintendo');
    expect(detectLayout('unknown HID', '')).toBe('custom');
    const p = raw('Nintendo Switch Pro');
    p.buttons[1] = { value: 1, pressed: true };
    expect(normalize(p, defaultConfig()).confirm).toBe(1);
    expect(normalize(p, defaultConfig()).boost).toBe(1);
  });
  it('supports remapping, raw trigger axes and confirm/cancel conventions', () => {
    const p = raw();
    const c = defaultConfig('custom');
    c.bindings.accelerate = { kind: 'axis', index: 4, sign: 1, mode: 'trigger' };
    c.bindings.boost = { kind: 'button', index: 5 };
    c.swapConfirmCancel = true;
    p.axes = [0, 0, 0, 0, -0.5];
    p.buttons[5] = { value: 1, pressed: true };
    p.buttons[1] = { value: 1, pressed: true };
    const v = normalize(p, c);
    expect(v.accelerate).toBe(0.25);
    expect(v.boost).toBe(1);
    expect(v.confirm).toBe(1);
  });
  it('validates bounded account configuration', () => {
    expect(controllerConfigSchema.safeParse(defaultConfig()).success).toBe(true);
    expect(controllerConfigSchema.safeParse({ ...defaultConfig(), deadZone: NaN }).success).toBe(
      false,
    );
    expect(
      controllerConfigSchema.safeParse({ ...defaultConfig(), steeringSensitivity: 100 }).success,
    ).toBe(false);
  });
});
describe('NexusInputManager lifecycle', () => {
  it('accepts the first command after reconnecting a neutral controller', () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    p.buttons[0] = { value: 1, pressed: true };
    h.tick();
    h.setPads([]);
    h.tick();
    p.buttons[0] = { value: 0, pressed: false };
    h.setPads([p]);
    h.tick();
    p.buttons[13] = { value: 1, pressed: true };
    h.tick();
    expect(h.manager.read().navDown).toBe(1);
    h.stop();
  });
  it('samples game input while presentation waits without starting extra RAF loops', () => {
    const h = harness(),
      p = raw();
    const times: number[] = [];
    h.manager.on((event) => {
      if (event.type === 'frame') times.push(event.time);
    });
    h.setPads([p]);
    h.manager.readFresh();
    h.manager.readFresh();
    p.buttons[7] = { value: 0.42, pressed: true };
    expect(h.manager.readFresh().accelerate).toBe(0.42);
    expect(h.queuedFrames()).toBe(1);
    h.tick();
    h.manager.readFresh();
    expect(times).toEqual([...times].sort((a, b) => a - b));
    h.setPads([]);
    expect(h.manager.readFresh().accelerate).toBe(0);
    expect(h.queuedFrames()).toBe(1);
    h.stop();
  });
  it('discovers devices connected before startup and after loading', () => {
    const h = harness(),
      events: string[] = [];
    h.manager.on((e) => {
      if (e.type !== 'frame') events.push(e.type);
    });
    const p = raw();
    h.setPads([p]);
    h.tick();
    expect(h.manager.getSnapshot().devices).toHaveLength(1);
    const second = { ...raw('DualSense'), index: 1 };
    h.setPads([p, second]);
    h.tick();
    expect(events.filter((e) => e === 'connected')).toHaveLength(2);
    h.manager.setActive(1);
    expect(h.manager.getSnapshot().activeIndex).toBe(1);
    h.stop();
  });
  it('neutralizes a lost active controller and requires release before reconnection', () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    p.buttons[7] = { value: 1, pressed: true };
    h.tick();
    expect(h.manager.read().accelerate).toBe(1);
    h.setPads([]);
    h.tick();
    expect(h.manager.read().accelerate).toBe(0);
    h.setPads([p]);
    h.tick();
    expect(h.manager.read().accelerate).toBe(0);
    p.buttons[7] = { value: 0, pressed: false };
    h.tick();
    p.buttons[7] = { value: 0.6, pressed: true };
    h.tick();
    expect(h.manager.read().accelerate).toBe(0.6);
    h.stop();
  });
  it('does not switch input method or re-render metadata due to small stick noise', () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    let metadataUpdates = 0;
    h.manager.subscribe(() => metadataUpdates++);
    p.axes = [0.05, -0.07, 0, 0];
    h.tick();
    expect(h.manager.getSnapshot().method).toBe('keyboard');
    expect(metadataUpdates).toBe(0);
    p.buttons[0] = { value: 1, pressed: true };
    h.tick();
    expect(h.manager.getSnapshot().method).toBe('gamepad');
    h.manager.setMethod('mouse');
    h.tick();
    expect(h.manager.getSnapshot().method).toBe('mouse');
    h.stop();
  });
  it('provides one edge per press to independent runtime consumers', () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    const release = h.manager.acquire('game');
    p.buttons[9] = { value: 1, pressed: true };
    h.tick();
    expect(h.manager.consume('pause', 'game')).toBe(true);
    expect(h.manager.consume('pause', 'game')).toBe(false);
    expect(h.manager.consume('pause', 'other')).toBe(true);
    h.tick();
    expect(h.manager.consume('pause', 'game')).toBe(false);
    release();
    h.stop();
  });
  it('handles unavailable haptics and actuator rejection without throwing', async () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    expect(await h.manager.haptic('test')).toBe(false);
    const playEffect = vi.fn().mockRejectedValue(new Error('unsupported'));
    Object.assign(p, { vibrationActuator: { playEffect } });
    expect(await h.manager.haptic('test')).toBe(false);
    expect(await h.manager.haptic('test')).toBe(false);
    expect(playEffect).toHaveBeenCalledTimes(1);
    h.stop();
  });
  it('scales optional rumble and respects user opt-out', async () => {
    const h = harness(),
      p = raw();
    const playEffect = vi.fn().mockResolvedValue(true);
    Object.assign(p, { vibrationActuator: { playEffect } });
    h.setPads([p]);
    h.tick();
    h.manager.setConfig({ ...defaultConfig(), vibrationIntensity: 0.4 });
    expect(await h.manager.haptic('test')).toBe(true);
    expect(playEffect.mock.calls[0][1].strongMagnitude).toBeCloseTo(0.2);
    h.manager.setConfig({ ...defaultConfig(), vibrationEnabled: false });
    expect(await h.manager.haptic('test')).toBe(false);
    expect(playEffect).toHaveBeenCalledTimes(1);
    h.stop();
  });
});
describe('device-independent racing', () => {
  it('applies handbrake with the same server/client physics and validates its type', () => {
    const normal = { ...initialRace(), speed: 35 },
      braking = { ...normal };
    for (let i = 0; i < 15; i++) {
      stepRace(normal, { throttle: 0, brake: 0, steer: 0, nitro: false }, 1 / 30);
      stepRace(braking, { throttle: 0, brake: 0, steer: 0, nitro: false, handbrake: true }, 1 / 30);
    }
    expect(braking.speed).toBeLessThan(normal.speed - 10);
    expect(
      inputCommandSchema.safeParse({
        seq: 1,
        throttle: 0.4,
        brake: 0.2,
        steer: 0.3,
        nitro: false,
        handbrake: true,
      }).success,
    ).toBe(true);
    expect(
      inputCommandSchema.safeParse({
        seq: 1,
        throttle: 1,
        brake: 0,
        steer: 0,
        nitro: false,
        deviceType: 'bypass',
        speed: 999,
      }).success,
    ).toBe(false);
  });
});

describe('safe controller transitions', () => {
  it('does not replay a UI resume press as a new in-game pause', () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    p.buttons[9] = { value: 1, pressed: true };
    h.tick();
    const release = h.manager.acquire('game');
    expect(h.manager.consume('pause', 'runtime')).toBe(false);
    p.buttons[9] = { value: 0, pressed: false };
    h.tick();
    p.buttons[9] = { value: 1, pressed: true };
    h.tick();
    expect(h.manager.consume('pause', 'runtime')).toBe(true);
    release();
    h.stop();
  });
  it('keeps swapped Nintendo hints consistent with normalized actions', () => {
    const h = harness(),
      p = raw('Nintendo Switch Pro');
    h.setPads([p]);
    h.tick();
    h.manager.setConfig({ ...defaultConfig(), swapConfirmCancel: true });
    expect(h.manager.label('confirm')).toBe('B');
    expect(h.manager.label('cancel')).toBe('A');
    h.stop();
  });
  it('merges analog touch actions and clears them when focus is lost', () => {
    const h = harness();
    h.manager.setVirtual('accelerate', 0.35);
    h.manager.setVirtual('steer', -0.6);
    h.tick();
    expect(h.manager.getSnapshot().method).toBe('touch');
    expect(h.manager.read().accelerate).toBe(0.35);
    expect(h.manager.read().steer).toBe(-0.6);
    h.win.dispatchEvent(new Event('blur'));
    h.tick();
    expect(h.manager.read().accelerate).toBe(0);
    expect(h.manager.read().steer).toBe(0);
    h.stop();
  });
  it('waits for release after confirm/cancel remapping', () => {
    const h = harness(),
      p = raw();
    h.setPads([p]);
    h.tick();
    p.buttons[0] = { value: 1, pressed: true };
    h.tick();
    h.manager.setConfig({ ...defaultConfig(), swapConfirmCancel: true });
    h.tick();
    expect(h.manager.read().cancel).toBe(0);
    expect(h.manager.isNeutral()).toBe(false);
    p.buttons[0] = { value: 0, pressed: false };
    h.tick();
    p.buttons[0] = { value: 1, pressed: true };
    h.tick();
    expect(h.manager.read().cancel).toBe(1);
    h.stop();
  });
  it('detects replacement in the same browser slot', () => {
    const h = harness();
    h.setPads([raw('DualSense')]);
    h.tick();
    h.setPads([raw('Xbox replacement')]);
    h.tick();
    expect(h.manager.getSnapshot().devices[0].layout).toBe('xbox');
    expect(h.manager.assignedDevice(0)).toBe(0);
    h.stop();
  });
});
