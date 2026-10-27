import 'dotenv/config';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { defaultForgeSettings } from '../src/games/fold/settings';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3001';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
assert(
  /^nexus_gameplay_qa_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
  'Disposable local capture only',
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(90000);
const out = 'public/reports/fold-zero';
await fs.mkdir(out, { recursive: true });
let userId = '';
const report = {
  date: new Date().toISOString(),
  scope:
    'Actual running Foundry main-menu environment, native CSS/DPR1, software GPU. These are not combat screenshots or a gaming-PC benchmark.',
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  presets: [] as unknown[],
  passed: false,
};
const post = (url: string, data: unknown) =>
  page.request.post(origin + url, { headers: { Origin: origin }, data });
try {
  await page.addInitScript('globalThis.__name=fn=>fn;');
  await page.addInitScript(() => {
    const w = window as unknown as { forgeCapture: unknown[] };
    w.forgeCapture = [];
    window.addEventListener('nexus-forge-frame', (e) => {
      w.forgeCapture.push((e as CustomEvent).detail.stats);
      if (w.forgeCapture.length > 100) w.forgeCapture.shift();
    });
  });
  const name = 'forgecap_' + randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
  assert.equal(
    (
      await post('/api/register', {
        username: name,
        email: name + '@example.test',
        password,
        confirmPassword: password,
      })
    ).status(),
    201,
  );
  userId = (await db.user.findUniqueOrThrow({ where: { username: name } })).id;
  await page.goto(origin + '/login');
  await page.locator('[name=email]').fill(name + '@example.test');
  await page.locator('[name=password]').fill(password);
  await page.locator('.auth-submit').click();
  await page.waitForURL(origin + '/');
  const data = await (await page.request.get(origin + '/api/console')).json(),
    game = data.games.find((g: { slug: string }) => g.slug === 'fold-zero');
  assert(game);
  assert.equal((await post('/api/library', { action: 'add', gameId: game.id })).status(), 200);
  for (const quality of ['high', 'ultra'] as const) {
    assert.equal(
      (await post('/api/fold-settings', { ...defaultForgeSettings, quality })).status(),
      200,
    );
    await page.goto(origin + '/play/fold-zero');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid=fold-player]')?.getAttribute('data-loaded') === 'true',
    );
    await page.waitForFunction(
      () => (window as unknown as { forgeCapture: unknown[] }).forgeCapture.length >= 8,
      null,
      { timeout: 120000, polling: 250 },
    );
    await page.screenshot({ path: out + '/' + quality + '-menu.png' });
    const measured = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.forge-viewport canvas')!,
        gl = c.getContext('webgl2')!,
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        renderBuffer: { width: c.width, height: c.height },
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        samples: (window as unknown as { forgeCapture: unknown[] }).forgeCapture,
      };
    });
    report.presets.push({ quality, ...measured });
    console.log(JSON.stringify({ captured: quality, renderBuffer: measured.renderBuffer }));
  }
  await sharp(out + '/high-menu.png')
    .webp({ quality: 90 })
    .toFile('public/art/fold-foundry.webp');
  report.passed = true;
} catch (error) {
  console.error(
    JSON.stringify({
      capturePassed: false,
      error: error instanceof Error ? error.name : 'Unknown',
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  if (userId)
    await db.user.deleteMany({ where: { id: userId, username: { startsWith: 'forgecap_' } } });
  await db.$disconnect();
  await fs.mkdir('docs/fold-zero', { recursive: true });
  await fs.writeFile('docs/fold-zero/capture.json', JSON.stringify(report, null, 2) + '\n');
}
