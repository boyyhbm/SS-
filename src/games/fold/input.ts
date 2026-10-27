import { nexusInput } from '@/input/manager';
import type { ForgeCommand } from './contracts';
import { neutralCommand } from './contracts';
import type { ForgeSettings } from './settings';
export class ForgeInput {
  yaw = 0;
  pitch = 0;
  enabled = false;
  aiming = false;
  private keys = new Set<string>();
  private mouseFire = false;
  private mouseAim = false;
  private removePad: () => void;
  onMenu: () => void = () => {};
  onUnlock: () => void = () => {};
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
      if (e.type === 'disconnected' && e.active) {
        this.clear();
        this.onMenu();
      }
    });
  }
  private keyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (e.code === 'Escape') {
      this.onMenu();
      return;
    }
    if (['Space', 'ControlLeft', 'ShiftLeft', 'KeyF', 'KeyQ', 'KeyR'].includes(e.code))
      e.preventDefault();
    this.keys.add(e.code);
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private move = (e: MouseEvent) => {
    if (this.enabled && document.pointerLockElement === this.canvas) {
      this.yaw -= e.movementX * 0.002 * this.settings.mouseSensitivity;
      this.pitch -=
        e.movementY * 0.002 * this.settings.mouseSensitivity * (this.settings.invertY ? -1 : 1);
      this.limit();
    }
  };
  private down = (e: MouseEvent) => {
    if (!this.enabled) return;
    this.onUnlock();
    if (document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock()?.catch(() => {});
      return;
    }
    if (e.button === 0) this.mouseFire = true;
    if (e.button === 2) this.mouseAim = true;
  };
  private up = (e: MouseEvent) => {
    if (e.button === 0) this.mouseFire = false;
    if (e.button === 2) this.mouseAim = false;
  };
  private context = (e: Event) => e.preventDefault();
  private lock = () => {
    if (
      this.enabled &&
      document.pointerLockElement !== this.canvas &&
      nexusInput.getSnapshot().method !== 'gamepad'
    )
      this.onMenu();
  };
  private blur = () => {
    this.clear();
    if (this.enabled) this.onMenu();
  };
  private limit() {
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }
  sample(seq: number, aimTick: number, dt: number): ForgeCommand {
    if (!this.enabled) return { ...neutralCommand(seq), aimTick, yaw: this.yaw, pitch: this.pitch };
    const v = nexusInput.readFresh(),
      pad = nexusInput.getSnapshot().method === 'gamepad';
    this.aiming = pad ? v.brake > 0.3 : this.mouseAim;
    if (pad) {
      const curve = (n: number) => Math.sign(n) * Math.abs(n) ** this.settings.responseCurve;
      this.yaw -= curve(v.lookX) * 2.6 * dt * this.settings.aimSensitivity;
      this.pitch -=
        curve(v.lookY) * 2.2 * dt * this.settings.aimSensitivity * (this.settings.invertY ? -1 : 1);
      this.limit();
      if (nexusInput.consume('pause', 'forge')) this.onMenu();
    }
    const key = (s: string) => this.keys.has(s),
      moveX = pad ? v.moveX : Number(key('KeyD')) - Number(key('KeyA')),
      moveZ = pad ? v.moveY : Number(key('KeyS')) - Number(key('KeyW'));
    return {
      seq,
      aimTick,
      moveX,
      moveZ,
      yaw: this.yaw,
      pitch: this.pitch,
      fire: pad ? v.accelerate > 0.35 : this.mouseFire,
      aim: this.aiming,
      sprint: pad ? (nexusInput.raw()?.buttons[10]?.pressed ?? false) : key('ShiftLeft'),
      jump: pad ? v.jump > 0.5 : key('Space'),
      slide: pad ? v.camera > 0.5 : key('ControlLeft'),
      reload: pad ? v.handbrake > 0.5 : key('KeyR'),
      fold: pad ? v.nextSection > 0.5 : key('KeyF'),
      impulse: pad ? v.previousSection > 0.5 : key('KeyQ'),
    };
  }
  clear() {
    this.keys.clear();
    this.mouseFire = false;
    this.mouseAim = false;
    this.aiming = false;
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
