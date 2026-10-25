import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  statePath = '/tmp/nexus-visual-browser-state.json';
const mode = process.argv[2] ?? 'capture',
  quality = process.env.VISUAL_QUALITY ?? 'medium';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const saved = await readFile(statePath, 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const context = await browser.newContext({
  viewport: {
    width: Number(process.env.VISUAL_WIDTH ?? 1280),
    height: Number(process.env.VISUAL_HEIGHT ?? 800),
  },
  storageState: saved?.storage,
  reducedMotion: 'reduce',
});
await context.addInitScript((q) => {
  localStorage.setItem(
    'nexus-render-quality',
    JSON.stringify({ state: { quality: q }, version: 0 }),
  );
  window.nexusVisualSamples = [];
  window.addEventListener('nexus-render-stats', (e) => window.nexusVisualSamples.push(e.detail));
}, quality);
const page = await context.newPage(),
  errors = [],
  expectedResponses = [];
if (process.env.VISUAL_DRIVE === '1')
  await context.addInitScript(() => {
    let neutralSamples = 0;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        const root = document.querySelector('[data-testid="race-player"]');
        const active = window.nexusVisualDriving && root && neutralSamples++ > 3;
        const x = Number(root?.dataset.x ?? 95),
          z = Number(root?.dataset.z ?? 1),
          heading = Number(root?.dataset.heading ?? 0);
        const speed =
          Number(document.querySelector('[data-testid="speed"]')?.textContent ?? 0) / 3.6;
        const angle = -Math.atan2(z, x),
          error = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
        const steer = Math.max(
          -1,
          Math.min(1, -error * 2.8 + (Math.hypot(x, z) - 95) * 0.09 + speed / (95 * 1.12)),
        );
        return [
          {
            connected: true,
            index: 0,
            id: 'NEXUS capture controller',
            mapping: 'standard',
            timestamp: performance.now(),
            axes: [active ? steer : 0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, (_, i) => ({
              pressed: !!active && i === 7,
              touched: !!active && i === 7,
              value: active && i === 7 ? 1 : 0,
            })),
          },
        ];
      },
    });
  });
page.setDefaultTimeout(120000);
page.on('crash', () => console.log('Browser page crashed'));
browser.on('disconnected', () => console.log('Browser disconnected'));
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (
    m.location().url.split('?')[0] === `${origin}/api/controllers` &&
    m.text().includes('status of 401')
  ) {
    expectedResponses.push({
      path: '/api/controllers',
      status: 401,
      reason: 'Anonymous controller-profile probe',
    });
  } else errors.push(`${m.text()} (${m.location().url})`);
});
await mkdir('docs/visual-overhaul', { recursive: true });
try {
  await page.goto(origin);
  let data = await (await page.request.get(`${origin}/api/console`)).json();
  if (!data.user) {
    const username = `visual_${randomBytes(5).toString('hex')}`,
      password = randomBytes(18).toString('hex');
    await page.goto(`${origin}/register`);
    await page.locator('[name="username"]').fill(username);
    await page.locator('[name="email"]').fill(`${username}@example.test`);
    await page.locator('[name="password"]').fill(password);
    await page.locator('[name="confirmPassword"]').fill(password);
    await page.locator('.auth-submit').click();
    await page.waitForURL(origin + '/');
    data = await (await page.request.get(`${origin}/api/console`)).json();
    if (!data.user) throw Error('Real QA registration failed');
  }
  const game = data.games.find((g) => g.slug === 'midnight-outlaws');
  const response = await page.request.post(`${origin}/api/library`, {
    headers: { Origin: origin },
    data: { action: 'add', gameId: game.id },
  });
  if (!response.ok()) throw Error(`QA library operation failed: ${response.status()}`);
  await writeFile(
    statePath,
    JSON.stringify({ userId: data.user.id, storage: await context.storageState() }),
    { mode: 0o600 },
  );
  await chmod(statePath, 0o600);
  console.log('QA account and personal library ready.');
  if (mode === 'console') {
    for (const [route, name] of [
      ['/', 'home'],
      ['/discover', 'discover'],
      ['/library', 'library'],
    ]) {
      await page.goto(origin + route);
      await page.locator('.os-console').waitFor();
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.console-main')).opacity === '1',
      );
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        [...document.images].every((i) => i.complete && i.naturalWidth > 0),
      );
      if (route === '/')
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector('.stage-game-dossier')).opacity === '1',
        );
      if (route === '/') {
        const overlap = await page.evaluate(() => {
          const cover = document.querySelector('.stage-game-rail .selected-card .game-cover');
          const dossier = document.querySelector('.stage-game-dossier');
          return (
            cover &&
            dossier &&
            cover.getBoundingClientRect().bottom > dossier.getBoundingClientRect().top
          );
        });
        if (overlap) throw Error('Selected cover overlaps the game dossier');
      }
      await page.screenshot({
        path: `docs/visual-overhaul/${name}.png`,
        fullPage: true,
        caret: 'initial',
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [route, name] of [
      ['/', 'home'],
      ['/discover', 'discover'],
      ['/library', 'library'],
    ]) {
      await page.goto(origin + route);
      await page.locator('.os-console').waitFor();
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.console-main')).opacity === '1',
      );
      await page.evaluate(() => document.fonts.ready);
      if (route === '/')
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector('.stage-game-dossier')).opacity === '1',
        );
      await page.waitForFunction(() =>
        [...document.images].every((i) => i.complete && i.naturalWidth > 0),
      );
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        throw Error(`Mobile horizontal overflow: ${route}`);
      const clippedActions = await page.locator('.os-console .hero .hero-actions > *').evaluateAll(
        (elements) => elements.some((element) => {
          const bounds = element.getBoundingClientRect();
          const hero = element.closest('.hero')?.getBoundingClientRect();
          return bounds.width > 0 &&
            (bounds.left < 0 || bounds.right > innerWidth || (hero && bounds.bottom > hero.bottom));
        }),
      );
      if (clippedActions) throw Error(`Clipped mobile hero action: ${route}`);
      await page.screenshot({
        path: `docs/visual-overhaul/${name}-mobile.png`,
        fullPage: true,
        caret: 'initial',
      });
    }
    const guest = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
    await guest.goto(origin);
    await guest.locator('.os-console').waitFor();
    await guest.waitForFunction(
      () => getComputedStyle(document.querySelector('.stage-game-dossier')).opacity === '1',
    );
    await guest.waitForFunction(() =>
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    );
    await guest.screenshot({
      path: 'docs/visual-overhaul/home-guest.png',
      fullPage: true,
      caret: 'initial',
    });
    await guest.close();
    console.log('Console screens captured.', JSON.stringify({ errors }));
  } else {
    const sceneStarted = Date.now();
    await page.goto(`${origin}/play/midnight-outlaws`);
    await page.locator('canvas[data-assets="glb-loaded"]').waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'На старт', exact: true }).waitFor({ timeout: 120000 });
    const sceneReadyMs = Date.now() - sceneStarted;
    console.log('Scene rendered with GLB textures.');
    if (mode !== 'benchmark')
      await page.screenshot({
        path: `docs/visual-overhaul/start-${quality}.png`,
        caret: 'initial',
      });
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await page.locator('.pause-overlay').waitFor({ state: 'detached' });
    if (process.env.VISUAL_DRIVE === '1') {
      await page.evaluate(() => {
        window.nexusVisualDriving = true;
      });
      await page.waitForFunction(
        () => Number(document.querySelector('[data-testid="speed"]')?.textContent ?? 0) > 80,
      );
    }
    console.log('Race started.');
    if (process.env.VISUAL_DRIVE === '1') {
      await page.locator('.controller-hints').waitFor({ state: 'hidden' });
      const hudFits = await page.locator('.nitro-meter').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= innerHeight;
      });
      if (!hudFits) throw Error('Nitro HUD leaves the visible game viewport');
    }
    if (mode !== 'benchmark') {
      await page.screenshot({
        path: `docs/visual-overhaul/gameplay-${quality}.png`,
        caret: 'initial',
      });
      const pixels = await page.locator('canvas').evaluate((c) => c.toDataURL('image/png'));
      await writeFile(
        `docs/visual-overhaul/render-${quality}.png`,
        Buffer.from(pixels.split(',')[1], 'base64'),
      );
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        window.nexusVisualDriving = false;
      });
      await page.getByRole('heading', { name: 'Город подождёт.', exact: true }).waitFor();
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.pause-card')).opacity === '1',
      );
      await page.screenshot({
        path: `docs/visual-overhaul/pause-${quality}.png`,
        caret: 'initial',
      });
      await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
      await page.locator('.pause-overlay').waitFor({ state: 'detached' });
      if (mode !== 'gameplay') {
        for (let i = 1; i <= 3; i++) {
          await page.keyboard.press('KeyC');
          await page.locator(`canvas[data-camera-mode="${i}"]`).waitFor();
        }
        await page.locator('canvas[data-camera-settled="true"]').waitFor();
        const keyart = await page.locator('canvas').evaluate((c) => c.toDataURL('image/png'));
        await writeFile(
          `docs/visual-overhaul/keyart-${quality}.png`,
          Buffer.from(keyart.split(',')[1], 'base64'),
        );
      }
    }
    if (mode === 'benchmark') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await page.evaluate(() => {
        window.nexusVisualSamples = [];
        window.nexusVisualMeasurementStarted = performance.now();
      });
      if (process.env.VISUAL_DRIVE !== '1') await page.keyboard.down('KeyW');
      await page.waitForTimeout(20000);
      await page.waitForFunction(
        () => window.nexusVisualSamples.filter((s) => !s.paused && s.frameMs > 0).length >= 8,
        null,
        { timeout: 60000 },
      );
      if (process.env.VISUAL_DRIVE !== '1') await page.keyboard.up('KeyW');
      const { samples, measurementWallMs } = await page.evaluate(() => ({
          samples: window.nexusVisualSamples,
          measurementWallMs: performance.now() - window.nexusVisualMeasurementStarted,
        })),
        metrics = await cdp.send('Performance.getMetrics');
      const browserCdp = await browser.newBrowserCDPSession();
      const processes = await browserCdp.send('SystemInfo.getProcessInfo');
      const processMemory = await Promise.all(
        processes.processInfo.map(async (p) => {
          const status = await readFile(`/proc/${p.id}/status`, 'utf8').catch(() => '');
          return {
            type: p.type,
            rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0),
            peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0),
          };
        }),
      );
      await writeFile(
        `docs/visual-overhaul/performance-${quality}.json`,
        JSON.stringify(
          {
            date: new Date().toISOString(),
            viewport: page.viewportSize(),
            quality,
            input: process.env.VISUAL_DRIVE === '1' ? 'automated-standard-gamepad' : 'keyboard-W',
            reducedMotion: 'reduce',
            sceneReadyMs,
            finalSpeedKmh: Number(await page.getByTestId('speed').textContent()),
            gpu: await page.locator('canvas').evaluate((canvas) => {
              const gl = canvas.getContext('webgl2'),
                extension = gl?.getExtension('WEBGL_debug_renderer_info');
              return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
            }),
            browser: await browser.version(),
            environment: 'Chromium headless / software WebGL; no physical GPU performance claim',
            samples,
            measurementWallMs,
            processMemory,
            cdpMetrics: metrics.metrics.filter((m) =>
              ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'TaskDuration'].includes(
                m.name,
              ),
            ),
            errors,
            expectedResponses,
          },
          null,
          2,
        ),
      );
    }
    console.log('Actual GLB scene captured.', JSON.stringify({ quality, errors }));
  }
  if (errors.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
