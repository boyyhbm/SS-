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
      this.camera.position.set(18 + Math.sin(time * 0.06) * 1.5, 10, 20);
      this.camera.lookAt(0, 1, 0);
    }
    const fov = menu || !aim ? 76 : 64;
    if (Math.abs(this.camera.fov - fov) > 0.005) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-14 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
