import { nexusInput } from '@/input/manager';
import { bindingValue, type InputBinding, type ControllerConfig } from '@/input/profiles';
import type { ForgeCommand } from './contracts';
import { neutralCommand } from './contracts';
import {
  bindingId,
  forgeActions,
  padActions,
  type ForgeAction,
  type ForgePadAction,
  type ForgeSettings,
} from './settings';
import { padPreferenceId, resolvePadBinding } from './bindings';
import { mouseRadians, stickResponse } from './control-math';

export type ForgePointerStatus =
  'idle' | 'standard' | 'raw-requested' | 'raw-unavailable' | 'unavailable';
export class ForgeInput {
  yaw = 0;
  pitch = 0;
  aiming = false;
  scoreboard = false;
  pointerStatus: ForgePointerStatus = 'idle';
  private active = false;
  private keys = new Set<string>();
  private blockedKeys = new Set<string>();
  private mouse = new Set<number>();
  private waitRelease = true;
  private ignoreMovement = true;
  private removePad: () => void;
  private padConfig: ControllerConfig | null = null;
  private padId = '';
  private padMap: ForgeSettings['controller']['bindings'] | null = null;
  private padValues = {} as Record<ForgePadAction, number>;
  private padBindings = {} as Record<ForgePadAction, InputBinding>;
  private axes = {} as Record<'moveX' | 'moveY' | 'lookX' | 'lookY', InputBinding>;
  onMenu: () => void = () => {};
  onUnlock: () => void = () => {};
  onScoreboard: (show: boolean) => void = () => {};
  onPointerStatus: (status: ForgePointerStatus) => void = () => {};
  constructor(
    private canvas: HTMLCanvasElement,
    public settings: ForgeSettings,
  ) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('mousemove', this.move);
    window.addEventListener('mouseup', this.up);
    canvas.addEventListener('mousedown', this.down);
    canvas.addEventListener('contextmenu', this.context);
    document.addEventListener('pointerlockchange', this.lock);
    window.addEventListener('blur', this.blur);
    this.removePad = nexusInput.on((e) => {
      if (e.type === 'disconnected' && e.active) this.pause();
    });
  }
  get enabled() {
    return this.active;
  }
  set enabled(value: boolean) {
    if (this.active !== value) {
      this.active = value;
      this.clear();
    }
  }
  configure(settings: ForgeSettings) {
    // PostgreSQL JSONB/cloud acknowledgements may reorder object properties.
    // Only a real binding change should invalidate held controls.
    const changed =
      forgeActions.some((a) => bindingId(this.settings.keys[a]) !== bindingId(settings.keys[a])) ||
      padActions.some(
        (a) =>
          padPreferenceId(this.settings.controller.bindings[a]) !==
          padPreferenceId(settings.controller.bindings[a]),
      );
    this.settings = settings;
    if (changed) this.clear();
  }
  private pressed(action: ForgeAction) {
    const b = this.settings.keys[action];
    return b.kind === 'key' ? this.keys.has(b.code) : this.mouse.has(b.button);
  }
  private pause() {
    const active = this.active;
    this.active = false;
    this.clear();
    if (active) this.onMenu();
  }
  private keyDown = (e: KeyboardEvent) => {
    if (!this.active) {
      this.blockedKeys.add(e.code);
      return;
    }
    if (this.blockedKeys.has(e.code)) {
      e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'Escape' || this.pressed('menu')) {
      e.preventDefault();
      this.pause();
      return;
    }
    if (Object.values(this.settings.keys).some((b) => b.kind === 'key' && b.code === e.code))
      e.preventDefault();
    this.setScoreboard(this.pressed('scoreboard'));
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.blockedKeys.delete(e.code);
    if (this.active) this.setScoreboard(this.pressed('scoreboard'));
  };
  private move = (e: MouseEvent) => {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    if (this.ignoreMovement) {
      this.ignoreMovement = false;
      return;
    }
    this.aiming = this.pressed('aim');
    this.yaw -= mouseRadians(e.movementX, 'x', this.settings.mouse, this.aiming);
    this.pitch -= mouseRadians(e.movementY, 'y', this.settings.mouse, this.aiming);
    this.limit();
  };
  async capturePointer() {
    if (typeof this.canvas.requestPointerLock !== 'function') {
      this.status('unavailable');
      return;
    }
    const request = this.canvas.requestPointerLock.bind(this.canvas) as (options?: {
      unadjustedMovement?: boolean;
    }) => Promise<void> | void;
    this.ignoreMovement = true;
    try {
      if (this.settings.mouse.rawInput) {
        this.status('raw-requested');
        await request({ unadjustedMovement: true });
      } else {
        await request();
        this.status('standard');
      }
    } catch {
      if (this.settings.mouse.rawInput) {
        this.status('raw-unavailable');
        try {
          await request();
        } catch {
          this.status('unavailable');
        }
      } else this.status('unavailable');
    }
  }
  private status(status: ForgePointerStatus) {
    this.pointerStatus = status;
    this.onPointerStatus(status);
  }
  private down = (e: MouseEvent) => {
    if (!this.active) return;
    this.onUnlock();
    if (document.pointerLockElement !== this.canvas) {
      void this.capturePointer();
      return;
    }
    this.mouse.add(e.button);
    if (this.pressed('menu')) {
      this.pause();
      return;
    }
    this.setScoreboard(this.pressed('scoreboard'));
  };
  private up = (e: MouseEvent) => {
    this.mouse.delete(e.button);
    if (this.active) this.setScoreboard(this.pressed('scoreboard'));
  };
  private context = (e: Event) => e.preventDefault();
  private lock = () => {
    if (document.pointerLockElement === this.canvas) {
      this.ignoreMovement = true;
      return;
    }
    if (this.active && nexusInput.getSnapshot().method !== 'gamepad') this.pause();
  };
  private blur = () => this.pause();
  private limit() {
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }
  private setScoreboard(show: boolean) {
    if (show !== this.scoreboard) {
      this.scoreboard = show;
      this.onScoreboard(show);
    }
  }
  sample(seq: number, aimTick: number, dt: number): ForgeCommand {
    const neutral = () => ({ ...neutralCommand(seq), aimTick, yaw: this.yaw, pitch: this.pitch });
    if (!this.active) return neutral();
    nexusInput.readFresh();
    const pad = nexusInput.gamepadReady ? nexusInput.raw() : null,
      snap = nexusInput.getSnapshot(),
      isPad = snap.method === 'gamepad';
    let mx = 0,
      mz = 0;
    const values = this.padValues;
    if (pad) {
      if (
        this.padConfig !== snap.config ||
        this.padId !== pad.id ||
        this.padMap !== this.settings.controller.bindings
      ) {
        this.padConfig = snap.config;
        this.padId = pad.id;
        this.padMap = this.settings.controller.bindings;
        for (const action of Object.keys(this.settings.controller.bindings) as ForgePadAction[])
          this.padBindings[action] = resolvePadBinding(
            this.settings.controller.bindings[action],
            snap.config,
            pad,
          );
        for (const action of ['moveX', 'moveY', 'lookX', 'lookY'] as const)
          this.axes[action] = resolvePadBinding({ kind: 'platform', action }, snap.config, pad);
      }
      for (const action of Object.keys(this.padBindings) as ForgePadAction[])
        values[action] = bindingValue(pad, this.padBindings[action], 0);
    }
    if (isPad) {
      if (!pad) return neutral();
      const s = this.settings.controller;
      mx = bindingValue(pad, this.axes.moveX, s.leftDeadzone);
      mz = bindingValue(pad, this.axes.moveY, s.leftDeadzone) * (snap.config.invertMoveY ? -1 : 1);
      const lx = bindingValue(pad, this.axes.lookX, s.rightDeadzone),
        ly = bindingValue(pad, this.axes.lookY, s.rightDeadzone);
      if (this.waitRelease) {
        if (
          Math.abs(mx) + Math.abs(mz) + Math.abs(lx) + Math.abs(ly) > 0.04 ||
          Object.values(values).some((v) => v > 0.2)
        )
          return neutral();
        this.waitRelease = false;
      }
      if ((pad.buttons[9]?.value ?? 0) > 0.5 || values.menu > 0.5) {
        this.pause();
        return neutral();
      }
      this.aiming = values.aim > 0.35;
      const ads = this.aiming ? s.ads : 1;
      this.yaw -= stickResponse(lx, s.curve, s.precisionExponent) * 2.6 * dt * s.x * ads;
      this.pitch -=
        stickResponse(ly, s.curve, s.precisionExponent) *
        2.2 *
        dt *
        s.y *
        ads *
        (s.invertY ? -1 : 1);
      this.limit();
      this.setScoreboard(values.scoreboard > 0.5);
    } else {
      this.waitRelease = false;
      mx = Number(this.pressed('right')) - Number(this.pressed('left'));
      mz = Number(this.pressed('backward')) - Number(this.pressed('forward'));
      this.aiming = this.pressed('aim');
      this.setScoreboard(this.pressed('scoreboard'));
    }
    const press = (a: ForgePadAction) => (isPad ? values[a] > 0.35 : this.pressed(a));
    return {
      seq,
      aimTick,
      moveX: mx,
      moveZ: mz,
      yaw: this.yaw,
      pitch: this.pitch,
      fire: press('fire'),
      aim: this.aiming,
      sprint: press('sprint'),
      jump: press('jump'),
      slide: press('slide'),
      reload: press('reload'),
      fold: press('fold') || press('interact'),
      impulse: press('impulse'),
    };
  }
  clear() {
    for (const key of this.keys) this.blockedKeys.add(key);
    this.keys.clear();
    this.mouse.clear();
    this.aiming = false;
    this.waitRelease = true;
    this.setScoreboard(false);
  }
  dispose() {
    this.clear();
    this.removePad();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('mousemove', this.move);
    window.removeEventListener('mouseup', this.up);
    this.canvas.removeEventListener('mousedown', this.down);
    this.canvas.removeEventListener('contextmenu', this.context);
    document.removeEventListener('pointerlockchange', this.lock);
    window.removeEventListener('blur', this.blur);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
