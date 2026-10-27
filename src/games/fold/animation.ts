import {
  AnimationMixer,
  LoopRepeat,
  type AnimationAction,
  type Object3D,
  type AnimationClip,
} from 'three';
import type { ForgePlayer } from './contracts';
export class ForgeAnimation {
  private mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private active = '';
  constructor(
    private root: Object3D,
    clips: AnimationClip[],
  ) {
    this.mixer = new AnimationMixer(root);
    for (const clip of clips) {
      const name = clip.name.split('|').at(-1) ?? clip.name;
      this.actions.set(name, this.mixer.clipAction(clip).setLoop(LoopRepeat, Infinity));
    }
  }
  update(p: ForgePlayer, dt: number, phase: string) {
    const speed = Math.hypot(p.vx, p.vz);
    const next =
      phase === 'finished'
        ? p.hp > 0
          ? 'Victory'
          : 'Defeat'
        : p.hp <= 0
          ? 'Defeat'
          : p.reload > 0
            ? 'Reload'
            : p.slide > 0
              ? 'Slide'
              : !p.grounded
                ? 'Jump'
                : speed > 7
                  ? 'Sprint'
                  : speed > 1
                    ? 'Walk'
                    : 'Idle';
    if (next !== this.active) {
      this.actions.get(this.active)?.fadeOut(0.13);
      this.actions.get(next)?.reset().fadeIn(0.13).play();
      this.active = next;
    }
    const action = this.actions.get(this.active);
    if (action && (next === 'Walk' || next === 'Sprint'))
      action.timeScale = Math.max(0.5, speed / (next === 'Walk' ? 4 : 7));
    this.mixer.update(dt);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
