import type { ForgeState } from '../../src/games/fold/contracts';
// Self-contained Playwright page fixture. Runs on the same input task cadence as
// a device rather than depending on slow CDP round trips during software rendering.
// Its only outputs are virtual Gamepad API values and normal DOM input events.
export function installForgeBrowserDriver({
  id,
  slot,
  device,
  tour = false,
}: {
  id: string;
  slot: number;
  device?: 'gamepad' | 'keyboard';
  tour?: boolean;
}) {
  const inputDevice = device ?? (slot === 0 ? 'gamepad' : 'keyboard');
  const w = window as unknown as {
    forgeState: ForgeState | null;
    forgePad: { axes: number[]; buttons: number[] };
    forgeDriver: unknown;
    forgeDriverStop?: () => void;
    forgeAim?: { yaw: number; pitch: number } | null;
  };
  let round = 0,
    index = 0,
    foldStage = false,
    folded = false,
    points: { x: number; z: number }[] = [],
    keys = new Set<string>(),
    mouseYaw = 0,
    mousePitch = 0,
    pulses = 0,
    firing = false;
  const raw = (n: number) =>
    Math.abs(n) < 0.0001 ? 0 : Math.sign(n) * (0.15 + 0.85 * Math.min(1, Math.abs(n)));
  const curve = (n: number) => raw(Math.sign(n) * Math.min(1, Math.abs(n)) ** (1 / 1.5));
  const timer = setInterval(() => {
    const s = w.forgeState,
      p = s?.players.find((p) => p.id === id),
      other = s?.players.find((p) => p.id !== id);
    if (!s || !p || !other) return;
    const localAim = w.forgeAim ?? p;
    let desiredYaw = p.yaw,
      desiredPitch = p.pitch,
      worldX = 0,
      worldZ = 0,
      fire = false,
      fold = false;
    const approach = (target: { x: number; z: number }) => {
      const dx = target.x - p.x,
        dz = target.z - p.z,
        distance = Math.hypot(dx, dz);
      const speed = Math.min(1, distance / 4);
      if (distance > 0.35) {
        worldX = (dx / distance) * speed;
        worldZ = (dz / distance) * speed;
      }
      return distance;
    };
    if (['active', 'overtime'].includes(s.phase)) {
      if (round !== s.round) {
        round = s.round;
        index = 0;
        foldStage = slot === 0 && !folded;
        const sign = p.z > 0 ? 1 : -1;
        points = foldStage && tour && p.z > 0
          ? [
              { x: -18.5, z: 13 },
              { x: -18.5, z: 2 },
              { x: -18.5, z: 13 },
              { x: -3.5, z: 13 },
              { x: -3.5, z: 6 },
              { x: -6, z: 6 },
            ]
          : foldStage && p.z < 0
            ? [
                { x: -3.5, z: -13 },
                { x: -19.5, z: -13 },
                { x: -19.5, z: 13 },
                { x: -3.5, z: 13 },
                { x: -3.5, z: 6 },
                { x: -6, z: 6 },
              ]
          : foldStage
          ? [
              { x: -3.5, z: 13 },
              { x: -3.5, z: 6 },
              { x: -6, z: 6 },
            ]
          : [
              { x: 19.5, z: sign * 13 },
              { x: 19.5, z: sign * 4 },
            ];
        mouseYaw = p.yaw;
        mousePitch = p.pitch;
      }
      const target = points[index];
      if (target) {
        const distance = approach(target);
        if (distance < 0.45) index++;
        else {
          desiredYaw = Math.atan2(p.x - target.x, p.z - target.z);
          desiredPitch = 0;
        }
      }
      if (index >= points.length) {
        if (foldStage) {
          if (s.nodes[0].state === 1) {
            folded = true;
            foldStage = false;
            points = [
              { x: -3.5, z: 6 },
              { x: -3.5, z: 13 },
              { x: 19.5, z: 13 },
              { x: 19.5, z: 4 },
            ];
            index = 0;
          } else {
            approach(points.at(-1)!);
            const dx = -6 - p.x,
              dz = 3.7 - p.z;
            desiredYaw = Math.atan2(-dx, -dz);
            desiredPitch = Math.atan2(1.1 - (p.y + 0.55), Math.hypot(dx, dz));
            fold = true;
          }
        } else {
          approach(points.at(-1)!);
          const dx = other.x - p.x,
            dz = other.z - p.z;
          desiredYaw = Math.atan2(-dx, -dz);
          desiredPitch = Math.atan2(other.y - p.y, Math.hypot(dx, dz));
          fire = slot === 0;
        }
      }
    }
    if (inputDevice === 'gamepad') {
      const dy = Math.atan2(
        Math.sin(desiredYaw - localAim.yaw),
        Math.cos(desiredYaw - localAim.yaw),
      );
      w.forgePad.axes = [
        raw(worldX * Math.cos(localAim.yaw) - worldZ * Math.sin(localAim.yaw)),
        raw(worldX * Math.sin(localAim.yaw) + worldZ * Math.cos(localAim.yaw)),
        curve(-dy * 2),
        curve((-(desiredPitch - localAim.pitch) * 2) / 2.2),
      ];
      w.forgePad.buttons.fill(0);
      w.forgePad.buttons[7] = fire ? 1 : 0;
      w.forgePad.buttons[5] = fold ? 1 : 0;
      w.forgePad.buttons[2] = p.ammo === 0 ? 1 : 0;
    } else {
      const observed = w.forgeAim;
      if (observed) {
        mouseYaw = observed.yaw;
        mousePitch = observed.pitch;
      }
      const dy = Math.atan2(Math.sin(desiredYaw - mouseYaw), Math.cos(desiredYaw - mouseYaw));
      if (['active', 'overtime'].includes(s.phase))
        window.dispatchEvent(
          new MouseEvent('mousemove', {
            movementX: -dy / 0.002,
            movementY: -(desiredPitch - mousePitch) / 0.002,
          }),
        );
      mouseYaw = desiredYaw;
      mousePitch = desiredPitch;
      const sx = worldX * Math.cos(desiredYaw) - worldZ * Math.sin(desiredYaw),
        sz = worldX * Math.sin(desiredYaw) + worldZ * Math.cos(desiredYaw),
        pulse = (pulses++ % 10) / 10;
      const next = new Set<string>();
      if (fold) next.add('KeyF');
      if (p.ammo === 0) next.add('KeyR');
      if (fire !== firing) {
        const canvas = document.querySelector('.forge-viewport canvas');
        (canvas ?? window).dispatchEvent(
          new MouseEvent(fire ? 'mousedown' : 'mouseup', { button: 0, bubbles: true }),
        );
        firing = fire;
      }
      if (Math.abs(sx) > 0.04 && pulse < Math.abs(sx)) next.add(sx > 0 ? 'KeyD' : 'KeyA');
      if (Math.abs(sz) > 0.04 && pulse < Math.abs(sz)) next.add(sz > 0 ? 'KeyS' : 'KeyW');
      for (const key of keys)
        if (!next.has(key)) window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
      for (const key of next)
        if (!keys.has(key)) window.dispatchEvent(new KeyboardEvent('keydown', { code: key }));
      keys = next;
    }
    w.forgeDriver = {
      at: Date.now(),
      round,
      index,
      folded,
      foldStage,
      position: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch },
      desiredYaw,
      worldX,
      worldZ,
      fold,
      fire,
      pointerLocked: !!document.pointerLockElement,
      menu: !!document.querySelector('.forge-menu'),
    };
  }, 1000 / 30);
  w.forgeDriverStop = () => {
    clearInterval(timer);
    w.forgePad.axes.fill(0);
    w.forgePad.buttons.fill(0);
    for (const key of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
  };
}
