import { foldDefinitions, inFoldSweep } from './arena';
import { balance, FOLD_DT } from './config';
import type { ForgeCommand, ForgePlayer, ForgeState } from './contracts';
import type { ForgePhysics } from './physics';
export function aimDirection(yaw: number, pitch: number) {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}
export class ForgeArena {
  update(
    state: ForgeState,
    inputs: Map<string, ForgeCommand>,
    physics: ForgePhysics,
    event: (type: 'fold' | 'fold-cancel', p: ForgePlayer) => void,
  ) {
    const time = state.tick * FOLD_DT;
    for (const n of state.nodes) {
      const def = foldDefinitions.find((d) => d.id === n.id)!;
      if (n.phase === 'warning' && time >= n.until) {
        const occupied = state.players.some((p) => p.hp > 0 && inFoldSweep(def, p));
        if (occupied) {
          n.phase = 'idle';
          n.target = n.state;
          n.availableAt = time + 1;
          const p = state.players.find((p) => p.id === n.activator);
          if (p) {
            p.foldCharges++;
            event('fold-cancel', p);
          }
        } else {
          n.phase = 'moving';
          n.progress = 0;
          n.until = time + balance.foldAnimation;
        }
      } else if (n.phase === 'moving') {
        n.progress = Math.min(1, 1 - (n.until - time) / balance.foldAnimation);
        if (n.progress >= 1) {
          n.state = n.target;
          n.phase = 'idle';
          n.availableAt = time + balance.foldCooldown;
        }
      }
    }
    for (const p of state.players) {
      const input = inputs.get(p.id),
        dir = aimDirection(p.yaw, p.pitch);
      const candidate = foldDefinitions.find((d) => {
        const dx = d.node.x - p.x,
          dy = d.node.y - (p.y + 0.55),
          dz = d.node.z - p.z,
          length = Math.hypot(dx, dy, dz);
        const hit =
          length < balance.foldRange
            ? physics.ray(
                { x: p.x, y: p.y + 0.55, z: p.z },
                { x: dx / length, y: dy / length, z: dz / length },
                length,
                p.id,
              )
            : null;
        return (
          length < balance.foldRange &&
          (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(length, 0.01) > 0.76 &&
          (!hit || hit.distance >= length - 0.15)
        );
      });
      const n = candidate ? state.nodes.find((n) => n.id === candidate.id) : null;
      if (
        !input?.fold ||
        p.hp <= 0 ||
        !n ||
        n.phase !== 'idle' ||
        time < n.availableAt ||
        p.foldCharges <= 0
      ) {
        p.foldHold = 0;
        p.holdingNode = null;
        continue;
      }
      if (p.holdingNode !== n.id) {
        p.holdingNode = n.id;
        p.foldHold = 0;
      }
      p.foldHold += FOLD_DT;
      if (p.foldHold >= balance.foldHold) {
        n.target = n.state === 0 ? 1 : 0;
        n.phase = 'warning';
        n.until = time + balance.foldWarning;
        n.activator = p.id;
        p.foldCharges--;
        p.foldHold = 0;
        event('fold', p);
      }
    }
  }
}
