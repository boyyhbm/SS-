import { describe, expect, it } from 'vitest';
import { defaultConfig, bindingValue, type RawController } from '../src/input/profiles';
import {
  assignForgeBinding,
  bindingConflict,
  resolvePadBinding,
  padConflict,
} from '../src/games/fold/bindings';
import {
  defaultForgeSettings,
  forgeSaveSchema,
  forgeSettingsSchema,
  migrateForgeSettings,
  readForgeSettings,
} from '../src/games/fold/settings';
import { mouseRadians, stickResponse } from '../src/games/fold/control-math';
import { ForgeRenderPacer } from '../src/games/fold/render-pacer';

describe('FOLD user controls', () => {
  it('migrates old accounts while preferring the revisioned account slot', () => {
    const old = {
      quality: 'high',
      mouseSensitivity: 1.7,
      aimSensitivity: 1.3,
      responseCurve: 1.8,
      invertY: true,
      headBob: true,
      master: 0.5,
      weapons: 0.6,
      environment: 0.3,
      effects: 0.4,
    };
    const m = migrateForgeSettings(old);
    expect(m.mouse).toMatchObject({ sensitivity: 1.7, invertY: true, ads: 1 });
    expect(m.controller).toMatchObject({ x: 1.3, y: 1.3, precisionExponent: 1.8, ads: 1 });
    expect(m.graphics.quality).toBe('high');
    const record = forgeSaveSchema.parse({
      version: 2,
      revision: 4,
      settings: defaultForgeSettings,
      updatedAt: new Date().toISOString(),
      lastMutationId: crypto.randomUUID(),
    });
    expect(readForgeSettings({ 'forge-settings-v1': old, 'forge-settings-v2': record })).toEqual(
      record,
    );
    expect(migrateForgeSettings({ ...old, mouseSensitivity: Infinity })).toEqual(
      defaultForgeSettings,
    );
  });
  it('swaps conflicting bindings without leaving an action unbound, and keeps Escape safe', () => {
    const keys = structuredClone(defaultForgeSettings.keys);
    expect(bindingConflict(keys, 'forward', keys.reload)).toBe('reload');
    expect(() => assignForgeBinding(keys, 'forward', keys.reload, false)).toThrow(
      'bindingConflict',
    );
    const next = assignForgeBinding(keys, 'forward', keys.reload, true);
    expect(next.forward).toEqual(keys.reload);
    expect(next.reload).toEqual(keys.forward);
    expect(forgeSettingsSchema.safeParse({ ...defaultForgeSettings, keys: next }).success).toBe(
      true,
    );
    expect(() => assignForgeBinding(keys, 'fire', { kind: 'key', code: 'Escape' }, true)).toThrow(
      'escapeReserved',
    );
    expect(() => assignForgeBinding(keys, 'menu', keys.fire, true)).toThrow('reservedSwap');
    expect(
      forgeSettingsSchema.safeParse({
        ...defaultForgeSettings,
        keys: { ...keys, forward: keys.fire },
      }).success,
    ).toBe(false);
    expect(
      forgeSettingsSchema.safeParse({
        ...defaultForgeSettings,
        mouse: { ...defaultForgeSettings.mouse, sensitivity: NaN },
      }).success,
    ).toBe(false);
  });
  it('preserves platform device layouts while resolving per-game overrides and conflicts', () => {
    const cfg = defaultConfig();
    const pad = { id: 'Nintendo Switch Pro Controller', mapping: 'standard' };
    expect(resolvePadBinding(defaultForgeSettings.controller.bindings.jump, cfg, pad)).toEqual({
      kind: 'button',
      index: 1,
    });
    expect(resolvePadBinding({ kind: 'button', index: 3 }, cfg, pad)).toEqual({
      kind: 'button',
      index: 3,
    });
    expect(
      padConflict(
        defaultForgeSettings.controller.bindings,
        'fire',
        { kind: 'button', index: 3 },
        cfg,
        pad,
      ),
    ).toBe('interact');
    expect(cfg).toEqual(defaultConfig());
  });
  it('applies independent mouse axes and ADS without frame-time scaling or acceleration', () => {
    const s = {
      ...defaultForgeSettings.mouse,
      sensitivity: 2,
      x: 1.4,
      y: 0.6,
      ads: 0.5,
      invertY: true,
    };
    expect(mouseRadians(100, 'x', s, false)).toBeCloseTo(0.56);
    expect(mouseRadians(100, 'y', s, false)).toBeCloseTo(-0.24);
    expect(mouseRadians(100, 'x', s, true)).toBeCloseTo(0.28);
    for (const frames of [30, 60, 120]) {
      const sum = Array.from({ length: frames }, () =>
        mouseRadians(600 / frames, 'x', s, false),
      ).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(mouseRadians(600, 'x', s, false));
    }
  });
  it('gives monotone stick curves and independent real deadzones', () => {
    for (const curve of ['linear', 'dynamic', 'precision'] as const) {
      expect(stickResponse(0, curve)).toBe(0);
      expect(stickResponse(1, curve)).toBe(1);
      let previous = -1;
      for (let i = -100; i <= 100; i++) {
        const value = stickResponse(i / 100, curve);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
      expect(stickResponse(-0.4, curve)).toBeCloseTo(-stickResponse(0.4, curve));
    }
    expect(stickResponse(0.3, 'precision')).toBeLessThan(stickResponse(0.3, 'linear'));
    const pad: RawController = {
      id: 'test',
      mapping: 'standard',
      connected: true,
      index: 0,
      axes: [0.12, 0, 0.12, 0],
      buttons: [],
    };
    expect(bindingValue(pad, defaultConfig().bindings.moveX, 0.2)).toBe(0);
    expect(bindingValue(pad, defaultConfig().bindings.lookX, 0.05)).toBeGreaterThan(0);
  });
});
describe('presentation cap preserves independent simulation cadence', () => {
  it.each([30, 60, 120])('presents %i frames on a 120 Hz callback clock', (cap) => {
    const clock = new ForgeRenderPacer();
    let count = 0;
    for (let i = 0; i < 1200; i++) if (clock.ready((i * 1000) / 120, cap)) count++;
    expect(count).toBe(cap * 10);
  });
  it('does not halve 59.94 Hz, and tolerates an explicit cap change and a long stall', () => {
    const clock = new ForgeRenderPacer();
    let count = 0;
    for (let i = 0; i < 600; i++) if (clock.ready((i * 1000) / 59.94, 60)) count++;
    expect(count).toBe(600);
    expect(clock.ready(20000, 60)).toBe(true);
    expect(clock.ready(20001, 60)).toBe(false);
    expect(clock.ready(20002, 120)).toBe(true);
    expect(clock.ready(20003, 0)).toBe(true);
  });
});
