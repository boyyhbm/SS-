import type { Page } from '@playwright/test';
import { cityRoutes } from '../../src/games/road-network.ts';
export async function installDriver(
  page: Page,
  method: 'gamepad' | 'keyboard' = 'gamepad',
  kind: 'online' | 'single' = 'online',
  cruiseSpeed?: number,
) {
  const routeId = await page
    .getByTestId(kind === 'single' ? 'race-player' : 'online-player')
    .getAttribute('data-route');
  const route = cityRoutes.find((r) => r.id === routeId);
  await page.evaluate(
    ({ method, kind, cruiseSpeed, route }) => {
      const button = (value = 0) => ({ pressed: value > 0.2, touched: value > 0.2, value });
      const fixture = (
        window as unknown as {
          nexusTestPads?: {
            pads: {
              id: string;
              index: number;
              connected: boolean;
              mapping: string;
              timestamp: number;
              axes: number[];
              buttons: { value: number; pressed: boolean; touched: boolean }[];
            }[];
            connected: boolean;
          };
        }
      ).nexusTestPads;
      const pad = fixture?.pads[0] ?? {
        id: 'NEXUS automated input device',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => button()),
      };
      let neutralSamples = 0;
      if (method === 'gamepad' && !fixture)
        Object.defineProperty(navigator, 'getGamepads', {
          configurable: true,
          value: () => [
            neutralSamples++ < 3
              ? { ...pad, axes: [0, 0, 0, 0], buttons: pad.buttons.map(() => button()) }
              : pad,
          ],
        });
      let duty = 0;
      let accelerating = true;
      const held = new Set<string>();
      const key = (code: string, down: boolean) => {
        if (held.has(code) === down) return;
        if (down) held.add(code);
        else held.delete(code);
        (document.querySelector('canvas') ?? document.body).dispatchEvent(
          new KeyboardEvent(down ? 'keydown' : 'keyup', {
            code,
            key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
            bubbles: true,
          }),
        );
      };
      const release = () => {
        for (const code of [...held]) key(code, false);
      };
      // The real input manager neutralizes keys on blur. Reset the fixture too,
      // so its next tick sends a new keydown rather than retaining a stale held bit.
      window.addEventListener('blur', release);
      document.addEventListener('visibilitychange', release);
      function update(sample?: { x: number; z: number; heading: number; speed: number }) {
        const root = document.querySelector(
          kind === 'online' ? '[data-testid="online-player"]' : '[data-testid="race-player"]',
        ) as HTMLElement | null;
        if (
          root &&
          (kind === 'online'
            ? root.dataset.phase === 'racing'
            : !document.querySelector('.pause-overlay')) &&
          !(window as unknown as { nexusDriverPaused?: boolean }).nexusDriverPaused
        ) {
          const x = sample?.x ?? Number(root.dataset.x),
            z = sample?.z ?? Number(root.dataset.z),
            heading = sample?.heading ?? Number(root.dataset.heading),
            speed =
              sample?.speed ??
              (kind === 'online'
                ? Number(root.dataset.speed)
                : Number(document.querySelector('[data-testid="speed"]')?.textContent ?? 0) / 3.6);
          const desired = -Math.atan2(z, x),
            error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
          let steer = Math.max(
            -1,
            Math.min(1, -error * 2.8 + (Math.hypot(x, z) - 95) * 0.09 + speed / (95 * 1.12)),
          );
          let targetSpeed = cruiseSpeed;
          if (route) {
            const path = route.path;
            let index = 0,
              minimum = Infinity;
            for (let i = 1; i < path.length; i++) {
              const a = path[i - 1],
                b = path[i],
                dx = b.x - a.x,
                dz = b.z - a.z,
                t = Math.max(
                  0,
                  Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)),
                ),
                d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
              if (d < minimum) {
                minimum = d;
                index = i - 1;
              }
            }
            let remaining = 8 + speed * 0.4,
              target = path[index],
              i = index,
              wraps = 0;
            while (remaining > 0) {
              if (i >= path.length - 1) {
                if (route.kind === 'circuit' && wraps++ < 1) i = 0;
                else break;
              }
              const a = path[i],
                b = path[++i],
                len = Math.hypot(b.x - a.x, b.z - a.z);
              if (remaining < len) {
                target = {
                  x: a.x + ((b.x - a.x) * remaining) / len,
                  z: a.z + ((b.z - a.z) * remaining) / len,
                };
                break;
              }
              remaining -= len;
              target = b;
            }
            const angle = Math.atan2(target.x - x, target.z - z),
              err = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)),
              look = Math.max(4, Math.hypot(target.x - x, target.z - z));
            steer = Math.max(
              -1,
              Math.min(
                1,
                -Math.atan2(5.6 * Math.sin(err), look) / (0.52 / (1 + Math.abs(speed) / 14)),
              ),
            );
            const override =
              (window as unknown as { nexusDriverCruiseSpeed?: number }).nexusDriverCruiseSpeed ??
              cruiseSpeed ??
              27;
            targetSpeed = Math.min(
              override,
              Math.abs(err) > 0.55 ? 10 : Math.abs(err) > 0.22 ? 17 : override,
            );
          }
          if (method === 'gamepad') {
            const boosting =
              !!route &&
              (window as unknown as { nexusDriverNitro?: boolean }).nexusDriverNitro === true;
            if (route) pad.buttons[0] = button(boosting ? 1 : 0);
            // Public WAN checks can opt into a calmer pace for software rendering.
            // The default retains the full-throttle local integration fixture.
            pad.axes[0] =
              targetSpeed === undefined
                ? steer
                : Math.abs(steer) < 0.001
                  ? 0
                  : Math.sign(steer) * (0.15 + Math.abs(steer) * 0.85);
            pad.buttons[7] = button(
              targetSpeed === undefined
                ? 1
                : Math.max(
                    0,
                    Math.min(
                      1,
                      (route
                        ? (0.8 + 0.0055 * targetSpeed * targetSpeed) / (boosting ? 17 : 10)
                        : 0.2) +
                        (targetSpeed - speed) * (route ? 0.22 : 0.15),
                    ),
                  ),
            );
            pad.buttons[6] = button(
              route && targetSpeed !== undefined && speed > targetSpeed + 2
                ? Math.min(1, (speed - targetSpeed) * 0.12)
                : 0,
            );
          } else {
            duty += Math.abs(steer);
            const turn = duty >= 1;
            if (turn) duty -= 1;
            if (targetSpeed === undefined || speed < targetSpeed - 1) accelerating = true;
            else if (speed > targetSpeed + 2) accelerating = false;
            key('KeyW', accelerating);
            key('KeyS', targetSpeed !== undefined && speed > targetSpeed + (route ? 2 : 7));
            key('KeyD', turn && steer > 0);
            key('KeyA', turn && steer < 0);
          }
        } else {
          pad.buttons[7] = button();
          pad.buttons[6] = button();
          if (route) pad.buttons[0] = button();
          pad.axes[0] = 0;
          for (const code of ['KeyW', 'KeyA', 'KeyD', 'KeyS']) key(code, false);
        }
        pad.timestamp = performance.now();
      }
      update();
      if (route) {
        const canvas = document.querySelector<HTMLElement>('.race-canvas');
        if (canvas) canvas.dataset.instrumentation = 'true';
        window.addEventListener('nexus-simulation-tick', (e) => update((e as CustomEvent).detail));
      }
      setInterval(update, 1000 / 30);
    },
    {
      method,
      kind,
      cruiseSpeed: cruiseSpeed ?? (kind === 'single' ? 18 : undefined),
      route: route ? { path: route.path, kind: route.kind } : null,
    },
  );
}
