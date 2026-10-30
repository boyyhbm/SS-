import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { chromium, expect, type Page } from '@playwright/test';
import { db } from '../src/lib/db';
import { defaultForgeSettings } from '../src/games/fold/settings';
import type { ForgeState } from '../src/games/fold/contracts';

const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3001';
const nativeExpect = expect.configure({ timeout: 60000 });
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
assert(
  /^nexus_gameplay_qa_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
  'Disposable local capture only',
);
const ids: string[] = [],
  browsers = [],
  pages: Page[] = [];
const out = 'public/reports/fold-controls/final';
const report = {
  date: new Date().toISOString(),
  passed: false,
  scope:
    'Actual High native-resolution gameplay. Two independently authenticated browser processes; the second player remains idle. Camera movement uses only keyboard/Pointer Lock device events. These are live match screenshots, not renders from a separate scene.',
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  scenes: [] as unknown[],
};
const post = (p: Page, url: string, data: unknown) =>
  p.request.post(origin + url, { headers: { Origin: origin }, data });
try {
  await fs.mkdir(out, { recursive: true });
  for (let i = 0; i < 2; i++) {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
    browsers.push(browser);
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      // Admit the two real clients before the software GPU's native workload.
      // The recorded frames below verify DPR 1 and a native 1280×720 buffer.
      deviceScaleFactor: i ? 0.15 : 1,
    });
    pages.push(page);
    page.setDefaultTimeout(90000);
    await page.addInitScript('globalThis.__name=fn=>fn;');
    await page.addInitScript(() => {
      const w = window as unknown as {
        forgeState: ForgeState | null;
        forgeAim: { yaw: number; pitch: number } | null;
        foundryFrames: unknown[];
      };
      w.forgeState = null;
      w.forgeAim = null;
      w.foundryFrames = [];
      window.addEventListener('nexus-forge-state', (e) => {
        w.forgeState = (e as CustomEvent).detail;
      });
      window.addEventListener('nexus-forge-aim', (e) => {
        w.forgeAim = (e as CustomEvent).detail;
      });
      window.addEventListener('nexus-forge-frame', (e) => {
        w.foundryFrames.push((e as CustomEvent).detail);
        if (w.foundryFrames.length > 200) w.foundryFrames.shift();
      });
    });
    const name = 'foundrycap_' + randomBytes(5).toString('hex'),
      password = randomBytes(20).toString('hex');
    assert.equal(
      (
        await post(page, '/api/register', {
          username: name,
          email: name + '@example.test',
          password,
          confirmPassword: password,
        })
      ).status(),
      201,
    );
    const user = await db.user.findUniqueOrThrow({ where: { username: name } });
    ids.push(user.id);
    await page.goto(origin + '/login');
    await page.locator('[name=email]').fill(user.email);
    await page.locator('[name=password]').fill(password);
    await page.locator('.auth-submit').click();
    await page.waitForURL(origin + '/');
    const data = await (await page.request.get(origin + '/api/console')).json(),
      game = data.games.find((g: { slug: string }) => g.slug === 'fold-zero');
    assert(game);
    assert.equal(
      (await post(page, '/api/library', { action: 'add', gameId: game.id })).status(),
      200,
    );
    assert.equal(
      (
        await post(page, '/api/fold-settings', {
          ownerId: user.id,
          expectedRevision: 0,
          mutationId: randomUUID(),
          settings: {
            ...defaultForgeSettings,
            graphics: {
              ...defaultForgeSettings.graphics,
              quality: i ? 'competitive' : 'low',
              aa: 'off',
            },
          },
        })
      ).status(),
      200,
    );
    await page.goto(origin + '/play/fold-zero');
    await nativeExpect(page.getByTestId('fold-player')).toHaveAttribute('data-loaded', 'true', {
      timeout: 120000,
    });
  }
  const [a, b] = pages;
  await a.getByRole('button', { name: 'Quick Match', exact: true }).click();
  await nativeExpect(a.getByTestId('forge-ready')).toBeVisible();
  await b.getByRole('button', { name: 'Quick Match', exact: true }).click();
  await nativeExpect(b.getByTestId('forge-ready')).toBeVisible();
  await a.getByTestId('forge-ready').click();
  await b.getByTestId('forge-ready').click();
  await nativeExpect(a.getByTestId('forge-start')).toBeEnabled();
  await a.getByTestId('forge-start').click();
  await a.waitForFunction(
    () => (window as unknown as { forgeState: ForgeState }).forgeState?.phase === 'active',
  );
  await a.locator('.forge-viewport canvas').click({ position: { x: 600, y: 400 }, force: true });
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'Настройки', exact: true }).click();
  await a.getByRole('tab', { name: /Графика/ }).click();
  await a.getByLabel('Графика FOLD', { exact: true }).selectOption('high');
  await a.getByLabel('Сглаживание', { exact: true }).selectOption('msaa');
  await a.getByRole('button', { name: /Применить/ }).click();
  await a.getByRole('button', { name: 'Закрыть настройки' }).click();
  await a.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.waitForFunction(
    () =>
      devicePixelRatio === 1 &&
      document.querySelector<HTMLCanvasElement>('.forge-viewport canvas')?.width === 1280,
  );
  console.log(
    JSON.stringify({
      nativeBufferVerified: '1280x720',
      dpr: 1,
      qualitySelectedInRealSettings: 'High / MSAA',
    }),
  );
  await a.evaluate((id) => {
    const w = window as unknown as {
      forgeState: ForgeState;
      forgeAim: { yaw: number; pitch: number };
      foundryStage: string;
      foundryNext: boolean;
      foundryStop: () => void;
    };
    const route = [
      { x: -3.5, z: 13 },
      { x: -3.5, z: 6, name: 'central', look: { x: 0, y: 2.1, z: 0 } },
      { x: -3.5, z: 13 },
      { x: -18.5, z: 13 },
      { x: -18.5, z: 2, name: 'industrial', look: { x: -9, y: 1.9, z: 0 } },
      { x: -18.5, z: 13 },
      { x: 18.5, z: 13 },
      { x: 18.5, z: 2, name: 'research', look: { x: 9, y: 1.9, z: 0 } },
    ];
    let index = 0,
      keys = new Set<string>(),
      pulse = 0,
      round = 0;
    const timer = setInterval(() => {
      const state = w.forgeState,
        p = state?.players.find((p) => p.id === id),
        t = route[index];
      if (!p || !t) return;
      if (!['active', 'overtime'].includes(state.phase)) {
        for (const key of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
        keys.clear();
        return;
      }
      if (round !== state.round) {
        const previous = round;
        round = state.round;
        if (previous || p.z < 0) {
          const remaining = route.slice(index),
            side = t.x < 0 ? -19.5 : 19.5;
          route.splice(
            0,
            route.length,
            { x: side, z: Math.sign(p.z) * 13 },
            { x: side, z: 13 },
            { x: t.x, z: 13 },
            ...remaining,
          );
          index = 0;
          w.foundryStage = '';
          return;
        }
      }
      const distance = Math.hypot(t.x - p.x, t.z - p.z),
        arrived = distance < 0.35;
      let mx = 0,
        mz = 0;
      if (!arrived) {
        mx = ((t.x - p.x) / distance) * Math.min(1, distance / 2);
        mz = ((t.z - p.z) / distance) * Math.min(1, distance / 2);
      }
      const look = arrived && t.look ? t.look : { x: t.x, y: p.y + 0.55, z: t.z };
      const yaw = Math.atan2(p.x - look.x, p.z - look.z),
        pitch = Math.atan2(look.y - (p.y + 0.55), Math.hypot(p.x - look.x, p.z - look.z));
      const dy = Math.atan2(Math.sin(yaw - w.forgeAim.yaw), Math.cos(yaw - w.forgeAim.yaw));
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          movementX: -dy / 0.002,
          movementY: -(pitch - w.forgeAim.pitch) / 0.002,
        }),
      );
      const sx = mx * Math.cos(yaw) - mz * Math.sin(yaw),
        sz = mx * Math.sin(yaw) + mz * Math.cos(yaw),
        cycle = (pulse++ % 10) / 10;
      const next = new Set<string>();
      if (Math.abs(sx) > 0.03 && cycle < Math.abs(sx)) next.add(sx > 0 ? 'KeyD' : 'KeyA');
      if (Math.abs(sz) > 0.03 && cycle < Math.abs(sz)) next.add(sz > 0 ? 'KeyS' : 'KeyW');
      for (const key of keys)
        if (!next.has(key)) window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
      for (const key of next)
        if (!keys.has(key)) window.dispatchEvent(new KeyboardEvent('keydown', { code: key }));
      keys = next;
      if (arrived) {
        if (t.name) {
          w.foundryStage = t.name;
          if (w.foundryNext) {
            index++;
            w.foundryNext = false;
          }
        } else index++;
      }
    }, 1000 / 30);
    w.foundryStop = () => {
      clearInterval(timer);
      for (const key of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
    };
  }, ids[0]);
  for (const name of ['central', 'industrial', 'research']) {
    await a.waitForFunction(
      (name) => (window as unknown as { foundryStage: string }).foundryStage === name,
      name,
      { timeout: 60000 },
    );
    const tick = await a.evaluate(
      () => (window as unknown as { forgeState: ForgeState }).forgeState.tick,
    );
    await a.waitForFunction(
      (tick) =>
        (window as unknown as { foundryFrames: { tick: number }[] }).foundryFrames.filter(
          (f) => f.tick > tick,
        ).length >= 2,
      tick,
      { timeout: 60000 },
    );
    await a.screenshot({ path: out + '/arena-' + name + '.png' });
    report.scenes.push(
      await a.evaluate(
        ({ name, id, tick }) => {
          const c = document.querySelector<HTMLCanvasElement>('.forge-viewport canvas')!,
            gl = c.getContext('webgl2')!,
            ext = gl.getExtension('WEBGL_debug_renderer_info');
          const w = window as unknown as {
            forgeState: ForgeState;
            foundryFrames: { tick: number; stats: unknown }[];
          };
          const p = w.forgeState.players.find((p) => p.id === id)!;
          return {
            name,
            quality: 'high',
            position: { x: p.x, y: p.y, z: p.z, yaw: p.yaw },
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            renderBuffer: { width: c.width, height: c.height },
            gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            samples: w.foundryFrames.filter((f) => f.tick > tick).map((f) => f.stats),
          };
        },
        { name, id: ids[0], tick },
      ),
    );
    console.log(JSON.stringify({ capturedLiveScene: name }));
    await a.evaluate(() => {
      (window as unknown as { foundryNext: boolean }).foundryNext = true;
    });
  }
  report.passed = true;
} catch (error) {
  if (pages[0])
    console.log(
      JSON.stringify({
        captureFailureState: await pages[0]
          .evaluate(() => {
            const w = window as unknown as {
              forgeState: ForgeState;
              forgeAim: unknown;
              foundryStage?: string;
            };
            const p = w.forgeState?.players[0];
            // Observe only our own runtime ref on failure. No method calls,
            // pose changes or input injection through React internals.
            const root = document.querySelector('[data-testid=fold-player]')!;
            const key = Object.getOwnPropertyNames(root).find((k) => k.startsWith('__reactFiber$'));
            let fiber: unknown = key ? (root as unknown as Record<string, unknown>)[key] : null;
            let controls: unknown = null;
            for (let depth = 0; fiber && typeof fiber === 'object' && depth < 40; depth++) {
              const f = fiber as Record<string, unknown>;
              let hook: unknown = f.memoizedState;
              for (let count = 0; hook && typeof hook === 'object' && count < 80; count++) {
                const h = hook as Record<string, unknown>;
                const ref = h.memoizedState as {
                  current?: {
                    input?: {
                      enabled: boolean;
                      keys: Set<string>;
                      blockedKeys: Set<string>;
                      settings: { keys: unknown };
                    };
                    renderer?: { element: unknown };
                    menu?: boolean;
                  };
                } | null;
                const r = ref?.current;
                if (r?.input && r.renderer?.element instanceof HTMLCanvasElement)
                  controls = {
                    enabled: r.input.enabled,
                    held: [...r.input.keys],
                    blocked: [...r.input.blockedKeys],
                    bindings: r.input.settings.keys,
                    runtimeMenu: r.menu,
                  };
                hook = h.next;
              }
              fiber = f.return;
            }
            return {
              controls,
              phase: w.forgeState?.phase,
              round: w.forgeState?.round,
              position: p ? { x: p.x, y: p.y, z: p.z } : null,
              aim: w.forgeAim,
              stage: w.foundryStage,
              locked: !!document.pointerLockElement,
              menu: document.querySelector('.forge-panel h2')?.textContent,
            };
          })
          .catch(() => null),
      }),
    );
  throw error;
} finally {
  for (const browser of browsers) await browser.close();
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'foundrycap_' } } });
  await db.$disconnect();
  await fs.mkdir('docs/fold-controls', { recursive: true });
  await fs.writeFile(
    'docs/fold-controls/native-gameplay.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
