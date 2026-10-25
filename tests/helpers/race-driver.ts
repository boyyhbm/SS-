import type { Page } from '@playwright/test';
export async function installDriver(
  page: Page,
  method: 'gamepad' | 'keyboard' = 'gamepad',
  kind: 'online' | 'single' = 'online',
) {
  await page.evaluate(
    ({ method, kind }) => {
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
      const held = new Set<string>();
      const key = (code: string, down: boolean) => {
        if (held.has(code) === down) return;
        if (down) held.add(code);
        else held.delete(code);
        (document.querySelector('canvas') ?? document.body).dispatchEvent(
          new KeyboardEvent(down ? 'keydown' : 'keyup', {
            code,
            key: code === 'KeyW' ? 'w' : code === 'KeyD' ? 'd' : 'a',
            bubbles: true,
          }),
        );
      };
      function update() {
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
          const x = Number(root.dataset.x),
            z = Number(root.dataset.z),
            heading = Number(root.dataset.heading),
            speed =
              kind === 'online'
                ? Number(root.dataset.speed)
                : Number(document.querySelector('[data-testid="speed"]')?.textContent ?? 0) / 3.6;
          const desired = -Math.atan2(z, x),
            error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
          const steer = Math.max(
            -1,
            Math.min(1, -error * 2.8 + (Math.hypot(x, z) - 95) * 0.09 + speed / (95 * 1.12)),
          );
          if (method === 'gamepad') {
            pad.axes[0] = steer;
            pad.buttons[7] = button(1);
          } else {
            duty += Math.abs(steer);
            const turn = duty >= 1;
            if (turn) duty -= 1;
            key('KeyW', true);
            key('KeyD', turn && steer > 0);
            key('KeyA', turn && steer < 0);
          }
        } else {
          pad.buttons[7] = button();
          pad.axes[0] = 0;
          for (const code of ['KeyW', 'KeyA', 'KeyD']) key(code, false);
        }
        pad.timestamp = performance.now();
      }
      update();
      setInterval(update, 1000 / 30);
    },
    { method, kind },
  );
}
