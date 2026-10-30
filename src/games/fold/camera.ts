import { PerspectiveCamera } from 'three';
import type { V3 } from './arena';
import type { ForgePlayer } from './contracts';
export class ForgeCamera {
  readonly camera = new PerspectiveCamera(76, 1, 0.06, 150);
  update(
    pose: V3 | null,
    yaw: number,
    pitch: number,
    menu: boolean,
    time: number,
    dt: number,
    headBob: boolean,
    player?: ForgePlayer,
    aim = false,
    fieldOfView = 76,
  ) {
    if (pose && !menu) {
      const bob =
        headBob && player?.grounded
          ? Math.sin(time * 11) * Math.min(0.016, Math.hypot(player.vx, player.vz) * 0.002)
          : 0;
      this.camera.position.set(pose.x, pose.y + 0.55 + bob, pose.z);
      // Mouse angles are applied once, immediately. Camera position comes from
      // the exact same interpolated pose as local presentation, never raw ticks.
      this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      // Keep the menu viewpoint inside the architecture, below the wing roofs.
      this.camera.position.set(17 + Math.sin(time * 0.06) * 0.6, 4.3, 14.5);
      this.camera.lookAt(-1, 1.5, -1);
    }
    const base = Math.max(60, Math.min(105, fieldOfView));
    const fov = menu || !aim ? base : base * (64 / 76);
    if (Math.abs(this.camera.fov - fov) > 0.005) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-14 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
