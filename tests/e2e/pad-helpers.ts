import { expect, type Page } from '@playwright/test';
export async function virtualPad(page: Page, id = 'DualSense virtual test', mapping = 'standard') {
  await page.addInitScript(
    ({ id, mapping }) => {
      const pads = [
        {
          id,
          mapping,
          index: 0,
          connected: true,
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 18 }, () => ({ value: 0, pressed: false, touched: false })),
          timestamp: 0,
        },
      ];
      const control = { pads, connected: true };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => (control.connected ? control.pads : []),
      });
      (window as unknown as { nexusTestPads: typeof control }).nexusTestPads = control;
    },
    { id, mapping },
  );
}
export async function padButton(page: Page, index: number, value: number) {
  await page.evaluate(
    ({ index, value }) => {
      const state = (
        window as unknown as {
          nexusTestPads: {
            pads: { buttons: { value: number; pressed: boolean; touched: boolean }[] }[];
          };
        }
      ).nexusTestPads;
      state.pads[0].buttons[index] = { value, pressed: value > 0.5, touched: value > 0 };
    },
    { index, value },
  );
}
export async function pressPad(page: Page, index: number) {
  if (index === 4 || index === 5) {
    await page.locator('[data-section-link]').first().waitFor({ state: 'visible' });
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
  const before = Number((await page.locator('html').getAttribute('data-controller-command')) ?? 0);
  // Release after input acknowledgement, independently of GPU presentation cadence.
  // The fixture never invokes navigation or mutates application/game state.
  await page.evaluate(
    ({ index, before }) =>
      new Promise<void>((resolve, reject) => {
        const state = (
          window as unknown as {
            nexusTestPads: {
              pads: { buttons: { value: number; pressed: boolean; touched: boolean }[] }[];
            };
          }
        ).nexusTestPads;
        const release = () => {
          state.pads[0].buttons[index] = { value: 0, pressed: false, touched: false };
        };
        const observer = new MutationObserver(() => {
          if (Number(document.documentElement.dataset.controllerCommand ?? 0) > before) {
            release();
            observer.disconnect();
            clearTimeout(timeout);
            resolve();
          }
        });
        const timeout = setTimeout(() => {
          release();
          observer.disconnect();
          reject(Error('Controller command was not processed'));
        }, 15000);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-controller-command'],
        });
        state.pads[0].buttons[index] = { value: 1, pressed: true, touched: true };
      }),
    { index, before },
  );
  // The press was acknowledged above; a full navigation may reset that counter.
  await page.waitForFunction(
    () => document.documentElement.dataset.controllerReleased === 'true',
    undefined,
    { timeout: 15000 },
  );
}
// Route planning reads geometry only. Every focus movement is performed through the browser Gamepad API.
export async function focusPad(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ state: 'visible' });
  const route: string[] = [];
  for (let iteration = 0; iteration < 100; iteration++) {
    const result = await page.evaluate((selector) => {
      const scope =
        [...document.querySelectorAll('dialog[open]')].at(-1) ??
        document.querySelector('.pause-overlay') ??
        document;
      const list = [
        ...scope.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ),
      ].filter(
        (el) =>
          el.getClientRects().length &&
          !el.closest('[inert],[aria-hidden="true"]') &&
          getComputedStyle(el).visibility !== 'hidden',
      );
      const target = document.querySelector(selector),
        current = document.activeElement;
      const start = list.indexOf(current as HTMLElement),
        goal = list.indexOf(target as HTMLElement);
      if (current === target) return -1;
      if (start < 0) return 13;
      if (goal < 0) return -2;
      const rects = list.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const queue = [{ node: start, path: [] as number[] }],
        seen = new Set([start]);
      while (queue.length) {
        const item = queue.shift()!;
        for (const [button, dx, dy] of [
          [14, -1, 0],
          [15, 1, 0],
          [12, 0, -1],
          [13, 0, 1],
        ]) {
          if (
            dx &&
            list[item.node] instanceof HTMLInputElement &&
            ['range', 'number'].includes((list[item.node] as HTMLInputElement).type)
          )
            continue;
          const origin = rects[item.node];
          let best = -1,
            score = Infinity;
          for (let i = 0; i < rects.length; i++) {
            if (i === item.node) continue;
            const x = rects[i].x - origin.x,
              y = rects[i].y - origin.y;
            const forward = x * dx + y * dy;
            if (forward <= 8) continue;
            const cost = Math.hypot(x, y) + Math.abs(dx ? y : x) * 3;
            if (cost < score) {
              score = cost;
              best = i;
            }
          }
          if (best < 0 || seen.has(best)) continue;
          const path = [...item.path, button];
          if (best === goal) return path[0];
          seen.add(best);
          queue.push({ node: best, path });
        }
      }
      return -2;
    }, selector);
    if (result === -1) return;
    const position = await page.evaluate(() => {
      const el = document.activeElement;
      return `${el?.tagName}.${el?.className}:${el?.textContent?.trim().slice(0, 50)}`;
    });
    const edge = `${position} > ${result}`;
    route.push(edge);
    if (route.filter((v) => v === edge).length > 6)
      throw Error(`Controller focus cycle for ${selector}: ${route.slice(-12).join(' / ')}`);
    if (result === -2) {
      await page.waitForTimeout(100);
      continue;
    }
    await pressPad(page, result);
  }
  throw new Error(`Controller could not focus ${selector}`);
}
export async function activatePad(page: Page, selector: string, confirm = 0) {
  await focusPad(page, selector);
  await pressPad(page, confirm);
}
export async function typeWithPad(page: Page, selector: string, value: string) {
  await activatePad(page, selector);
  await expect(page.getByTestId('screen-keyboard')).toBeVisible();
  for (const char of value) {
    await activatePad(page, `[data-osk-key="${char === ' ' ? 'space' : char}"]`);
  }
  await pressPad(page, 9);
  await expect(page.getByTestId('screen-keyboard')).toHaveCount(0);
  await expect(page.locator(selector)).toHaveValue(value);
}
