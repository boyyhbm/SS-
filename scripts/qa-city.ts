// Actual browser captures only. Use an isolated local QA database, never production.
import { chromium, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { installDriver } from '../tests/helpers/race-driver.ts';
import { cityRoutes } from '../src/games/road-network.ts';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw Error('Local isolated QA only');
const mode = process.argv[2] ?? 'screens',
  out = process.env.NEXUS_QA_OUTPUT ?? 'docs/world-update',
  statePath = process.env.NEXUS_QA_STATE ?? '/tmp/nexus-city-visual-state.json';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-precise-memory-info',
  ],
});
const errors: string[] = [];
let saved = await readFile(statePath, 'utf8')
  .then(JSON.parse)
  .catch(() => null);
async function prepare(page: Page) {
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  const data = await (await page.request.get(origin + '/api/console')).json();
  if (!data.user) {
    const username = 'cityqa_' + randomBytes(5).toString('hex'),
      password = randomBytes(20).toString('hex');
    await page.goto(origin + '/register');
    for (const [name, value] of Object.entries({
      username,
      email: username + '@example.test',
      password,
      confirmPassword: password,
    }))
      await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('.auth-submit').click();
    await page.waitForURL(origin + '/');
  }
  const d = await (await page.request.get(origin + '/api/console')).json(),
    game = d.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws');
  const added = await page.request.post(origin + '/api/library', {
    headers: { Origin: origin },
    data: { action: 'add', gameId: game.id },
  });
  if (!added.ok()) throw Error('Actual library add failed');
  saved = { userId: d.user.id, storage: await page.context().storageState() };
  await writeFile(statePath, JSON.stringify(saved), { mode: 0o600 });
}
async function context(quality: string, dpr: number, record?: string) {
  const c = await browser.newContext({
    storageState: saved?.storage,
    viewport: {
      width: mode === 'performance' ? 1920 : 1280,
      height: mode === 'performance' ? 1080 : 720,
    },
    deviceScaleFactor: dpr,
    reducedMotion: ['video', 'performance', 'smoothness', 'collision'].includes(mode)
      ? 'no-preference'
      : 'reduce',
    ...(record
      ? { recordVideo: { dir: out + '/raw-video', size: { width: 1280, height: 720 } } }
      : {}),
  });
  await c.addInitScript((q) => {
    localStorage.setItem(
      'nexus-render-quality',
      JSON.stringify({ state: { quality: q, dynamicFov: false }, version: 0 }),
    );
    const w = window as unknown as { cityStats: unknown[]; cityCamera: unknown[] };
    w.cityStats = [];
    w.cityCamera = [];
    window.addEventListener('nexus-render-stats', (e) =>
      w.cityStats.push((e as CustomEvent).detail),
    );
  }, quality);
  c.setDefaultTimeout(Number(process.env.NEXUS_QA_TIMEOUT_MS ?? 180000));
  return c;
}
async function openRace(page: Page, id: string) {
  console.log('Loading actual game runtime:', id);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text());
  });
  if (['screens', 'video', 'collision', 'still'].includes(mode)) {
    const r = await page.request.post(origin + '/api/racing-settings', {
      headers: { Origin: origin },
      data: { racingLine: 'full' },
    });
    if (!r.ok()) throw Error('Actual racing preference update failed');
  }
  await page.goto(origin + '/play/midnight-outlaws');
  await page.getByRole('button', { name: 'На старт', exact: true }).waitFor();
  await page.locator(`[data-route-option="${id}"]`).click();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
  );
  await page.waitForFunction((id) => document.querySelector('canvas')?.dataset.route === id, id);
  await page.evaluate(() => document.fonts.ready);
  console.log('Actual game runtime ready:', id);
  if (['camera', 'smoothness', 'collision'].includes(mode))
    await page.evaluate(() => {
      (document.querySelector('.race-canvas') as HTMLElement).dataset.instrumentation = 'true';
    });
}
async function begin(page: Page) {
  await page.getByRole('button', { name: 'На старт', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.pause-overlay'));
}
const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceUncommitted:
    execFileSync('git', ['status', '--porcelain', '--', 'src', 'server', 'prisma'], {
      encoding: 'utf8',
    }).trim().length > 0,
  mode,
  origin,
  physicalController: 'NOT_TESTED',
  renderSource: 'Actual Next.js/Three.js GLB runtime; no generated images',
  errors,
  motionPreference: ['video', 'performance', 'smoothness', 'collision'].includes(mode)
    ? 'no-preference'
    : 'reduce',
  machine: {
    platform: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    cpuQuota: (await readFile('/sys/fs/cgroup/cpu.max', 'utf8').catch(() => 'unavailable')).trim(),
    memoryLimitBytes: (
      await readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => 'unavailable')
    ).trim(),
    nodeVersion: process.version,
    browserVersion: browser.version(),
    physicalGamingGpu: false,
  },
};
try {
  const setup = await context('low', 0.15),
    p = await setup.newPage();
  await prepare(p);
  await setup.close();
  if (mode === 'collision') {
    const c = await context('low', 0.5, 'collision'),
      page = await c.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { contactProof: unknown[] };
      w.contactProof = [];
      window.addEventListener('nexus-simulation-tick', (e) => {
        const s = (e as CustomEvent).detail;
        if (s.collision && s.collisionImpulse > 0)
          w.contactProof.push({
            x: s.x,
            z: s.z,
            speed: s.speed,
            impulse: s.collisionImpulse,
            yaw: s.impactYaw,
          });
      });
    });
    await openRace(page, 'downtown-circuit');
    await begin(page);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="speed"]')?.textContent) > 45,
    );
    await page.keyboard.down('KeyD');
    await page.waitForFunction(
      () => (window as unknown as { contactProof: unknown[] }).contactProof.length > 0,
    );
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyS');
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="speed"]')?.textContent) < 8,
    );
    await page.keyboard.up('KeyS');
    await page.screenshot({ path: out + '/physical-contact.png' });
    report.contacts = await page.evaluate(
      () => (window as unknown as { contactProof: unknown[] }).contactProof,
    );
    const video = page.video();
    await c.close();
    if (video) await rename(await video.path(), out + '/physical-contact.webm');
  } else if (mode === 'smoothness') {
    const c = await context('low', 0.15),
      page = await c.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { presentationTrace: Record<string, number>[] };
      w.presentationTrace = [];
      window.addEventListener('nexus-presentation-frame', (e) => {
        if (w.presentationTrace.length < 10000) w.presentationTrace.push((e as CustomEvent).detail);
      });
    });
    await openRace(page, 'downtown-circuit');
    await begin(page);
    await installDriver(page, 'gamepad', 'single', 27);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="race-player"]')?.getAttribute('data-lap') === '2',
      null,
      { timeout: 180000 },
    );
    await page.keyboard.press('F3');
    await page.screenshot({ path: out + '/developer-overlay.png' });
    const trace = await page.evaluate(() => ({
      frames: (window as unknown as { presentationTrace: unknown[] }).presentationTrace,
      stats: (window as unknown as { cityStats: unknown[] }).cityStats,
    }));
    report.trace = trace;
    const frames = trace.frames as {
      now: number;
      alpha: number;
      x: number;
      z: number;
      heading: number;
    }[];
    report.presentation = {
      frameCount: frames.length,
      staleInterpolationFrames: frames.filter((f) => f.alpha < -1e-6 || f.alpha > 1.0001).length,
      finiteTransforms: frames.every((f) => Object.values(f).every(Number.isFinite)),
      physicalDisplaySmoothness: 'UNVERIFIED_SOFTWARE_GPU',
    };
    if (frames.length < 20 || frames.some((f) => f.alpha < -1e-6 || f.alpha > 1.0001))
      throw Error('Presentation is running ahead of the fixed simulation');
    report.scope =
      'Actual full city lap with turns, analog input; software WebGL at DPR 0.15. Does not verify physical 60/120Hz output.';
    await c.close();
  } else if (mode === 'performance') {
    const results: Record<string, unknown>[] = [];
    report.results = results;
    const qualities = (
      process.env.NEXUS_QA_QUALITIES ?? 'low,medium,high,ultra,cinematic,auto'
    ).split(',');
    if (qualities.some((q) => !['auto', 'low', 'medium', 'high', 'ultra', 'cinematic'].includes(q)))
      throw Error('Unknown quality');
    for (const quality of qualities) {
      console.log('Measuring actual preset:', quality);
      const c = await context(quality, 1),
        page = await c.newPage();
      await openRace(page, cityRoutes[0].id);
      await begin(page);
      await installDriver(page, 'gamepad', 'single', 18);
      await page.waitForFunction(
        () => (window as unknown as { cityStats: unknown[] }).cityStats.length >= 1,
      );
      await page.evaluate(() => {
        (window as unknown as { cityStats: unknown[] }).cityStats = [];
      });
      const start = Date.now();
      await page.evaluate(
        ({ samples, maxWall }) => {
          Object.assign(window, {
            requiredFrameSamples: samples,
            benchmarkEndsAt: performance.now() + maxWall,
          });
        },
        {
          samples: Number(process.env.NEXUS_QA_FRAME_SAMPLES ?? 100),
          maxWall: Number(process.env.NEXUS_QA_BENCHMARK_MS ?? 600000),
        },
      );
      await page.waitForFunction(
        () => {
          const a = (
            window as unknown as { cityStats: { frameTimesMs: number[]; paused: boolean }[] }
          ).cityStats.filter((x) => !x.paused);
          return (
            (a.length >= 2 &&
              performance.now() >
                Number((window as unknown as { benchmarkEndsAt: number }).benchmarkEndsAt)) ||
            a.reduce((s, x) => s + x.frameTimesMs.length, 0) >=
              Number(
                (window as unknown as { requiredFrameSamples?: number }).requiredFrameSamples ??
                  100,
              )
          );
        },
        null,
        { timeout: 600000 },
      );
      const data = await page.evaluate(() => {
        const w = window as unknown as { cityStats: unknown[] };
        const canvas = document.querySelector('canvas')!,
          gl = canvas.getContext('webgl2')!,
          ext = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          samples: w.cityStats,
          gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
          viewport: [innerWidth, innerHeight],
          canvas: [canvas.width, canvas.height],
          memory: (performance as unknown as { memory?: unknown }).memory
            ? {
                ...Object.fromEntries(
                  ['usedJSHeapSize', 'totalJSHeapSize', 'jsHeapSizeLimit'].map((k) => [
                    k,
                    (performance as unknown as { memory: Record<string, number> }).memory[k],
                  ]),
                ),
              }
            : null,
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
        };
      });
      results.push({
        requestedQuality: quality,
        elapsedWallMs: Date.now() - start,
        deviceScaleFactor: 1,
        requiredSamples: Number(process.env.NEXUS_QA_FRAME_SAMPLES ?? 100),
        wallBudgetMs: Number(process.env.NEXUS_QA_BENCHMARK_MS ?? 600000),
        ...data,
      });
      await c.close();
      console.log('Preset measurement completed:', quality);
      await writeFile(out + '/performance-progress.json', JSON.stringify(report, null, 2) + '\n');
    }
    report.results = results;
    report.target60FPS = 'Not verified on a physical gaming PC; software WebGL measurements only';
  } else if (mode === 'still') {
    const quality = process.env.NEXUS_QA_QUALITY ?? 'high',
      c = await context(
        process.env.NEXUS_QA_STILL_TOUR === '1' ? 'low' : quality,
        process.env.NEXUS_QA_STILL_TOUR === '1' ? 0.15 : 1,
      ),
      page = await c.newPage();
    const nativeShot = async (name: string) => {
      const cdp = await c.newCDPSession(page);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
      });
      const png = Buffer.from(shot.data, 'base64');
      if (png.readUInt32BE(16) !== 1280 || png.readUInt32BE(20) !== 720)
        throw Error('Native screenshot resolution mismatch');
      await writeFile(out + '/' + name, png);
      await cdp.detach();
    };
    await openRace(page, 'downtown-circuit');
    if (process.env.NEXUS_QA_STILL_TOUR === '1')
      await page.getByRole('button', { name: 'Свободная тренировка', exact: true }).click();
    await begin(page);
    if (process.env.NEXUS_QA_STILL_TOUR === '1') {
      await installDriver(page, 'gamepad', 'single', 18, [
        { x: -160, z: 20 },
        { x: -160, z: -100 },
        { x: -40, z: -100 },
        { x: -40, z: 20 },
        { x: -160, z: 20 },
      ]);
      await page.waitForFunction(
        () => {
          const r = document.querySelector<HTMLElement>('[data-testid="race-player"]');
          return (
            !!r &&
            Math.abs(Number(r.dataset.z) - 20) < 5 &&
            Number(r.dataset.x) < -75 &&
            Number(r.dataset.x) > -100
          );
        },
        null,
        { polling: 100, timeout: 240000 },
      );
      console.log('Photo viewpoint reached with normalized input');
      await page.evaluate(() => Object.assign(window, { nexusDriverCruiseSpeed: 0 }));
      await page.waitForFunction(
        () => Number(document.querySelector('[data-testid="speed"]')?.textContent) < 2,
        null,
        { polling: 100 },
      );
      await page.evaluate(() => Object.assign(window, { nexusDriverPaused: true }));
      // Drive using genuine normalized input at a low navigation cost on the software GPU.
      // Reload the actual renderer through the real pause UI at native capture resolution.
      await page.getByRole('button', { name: 'Пауза', exact: true }).click({ force: true });
      await page.locator('[data-game-resume]').waitFor();
      console.log('Parked; loading native-resolution photo quality');
      const cdp = await c.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.getByLabel('Графика', { exact: true }).selectOption(quality);
      await page.waitForFunction(
        (q) => {
          const canvas = document.querySelector('canvas');
          return (
            canvas?.dataset.quality === q &&
            canvas.dataset.assets === 'glb-loaded' &&
            canvas.width === 1280 &&
            canvas.height === 720
          );
        },
        quality,
        { polling: 500 },
      );
      await page.locator('[data-game-resume]').click({ force: true });
      await page.waitForFunction(() => !document.querySelector('.pause-overlay'));
      report.navigation = {
        quality: 'low',
        deviceScaleFactor: 0.15,
        input: 'normalized virtual gamepad',
        poseInjection: false,
      };
      report.capture = {
        quality,
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        actualPausedUiQualityChange: true,
      };
    } else {
      await page.keyboard.down('KeyW');
      await page.waitForFunction(
        () => Number(document.querySelector('[data-testid="speed"]')?.textContent) > 20,
        null,
        { polling: 100 },
      );
      await page.keyboard.up('KeyW');
    }
    console.log('Capturing actual native-resolution gameplay');
    await nativeShot('gameplay.png');
    await page.keyboard.down('KeyC');
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.cameraMode === '1',
      null,
      { polling: 500, timeout: 120000 },
    );
    await page.keyboard.up('KeyC');
    await nativeShot('car-close.png');
    report.pose = await page
      .getByTestId('race-player')
      .evaluate((r) => ({ x: r.dataset.x, z: r.dataset.z, heading: r.dataset.heading }));
    await page.getByRole('button', { name: 'Пауза', exact: true }).click({ force: true });
    await page.locator('[data-game-resume]').waitFor();
    await nativeShot('pause.png');
    report.quality = quality;
    report.deviceScaleFactor = 1;
    report.scope =
      process.env.NEXUS_QA_STILL_TOUR === '1'
        ? 'Actual Free Drive with normalized virtual gamepad inputs on connected streets; no pose injection or performance certification'
        : 'Actual game runtime with normal keyboard input; not a performance benchmark';
    await c.close();
  } else if (mode === 'settings') {
    const c = await context('low', 0.15),
      page = await c.newPage();
    await openRace(page, 'downtown-circuit');
    await begin(page);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click({ force: true });
    await page.locator('[data-game-resume]').waitFor();
    const layouts = [];
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.locator('.graphics-settings').evaluate((root) => {
        const card = root.closest('.pause-card')!;
        const box = card.getBoundingClientRect();
        const controls = [...root.querySelectorAll('select,input,button')].map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width };
        });
        return {
          card: {
            left: box.left,
            right: box.right,
            scrollWidth: card.scrollWidth,
            clientWidth: card.clientWidth,
          },
          controls,
          viewport: innerWidth,
        };
      });
      if (
        geometry.card.scrollWidth > geometry.card.clientWidth + 1 ||
        geometry.controls.some(
          (r) => r.left < geometry.card.left || r.right > geometry.card.right || r.width < 1,
        )
      )
        throw Error('Graphics settings overflow the pause card');
      await page.screenshot({ path: out + `/pause-${viewport.width}.png`, scale: 'css' });
      layouts.push({ viewport, geometry });
    }
    report.layouts = layouts;
    report.scope =
      'Actual pause controls on desktop/mobile, Low/DPR0.15 scene; UI screenshots at CSS resolution, not High graphics evidence';
    await c.close();
  } else if (mode === 'screens') {
    const c = await context(process.env.NEXUS_QA_QUALITY ?? 'high', 1),
      page = await c.newPage();
    await openRace(page, 'downtown-circuit');
    await page.screenshot({ path: out + '/route-map.png' });
    await begin(page);
    await page.screenshot({ path: out + '/straight-markings.png' });
    await installDriver(page, 'gamepad', 'single', 22);
    await page.waitForFunction(
      () =>
        Number(document.querySelector('[data-testid="checkpoint"]')?.textContent?.split('/')[0]) >=
        3,
    );
    await page.screenshot({ path: out + '/junction.png' });
    await page.evaluate(() => {
      (window as unknown as { nexusDriverPaused: boolean }).nexusDriverPaused = true;
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Другой маршрут', exact: true }).click();
    await page.locator('[data-route-option="midnight-sprint"]').click();
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.race-route')?.textContent?.includes('Полуночный спринт'),
    );
    await page.screenshot({ path: out + '/curved-markings.png' });
    await page.keyboard.press('KeyC');
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.cameraMode === '1');
    await page.screenshot({ path: out + '/car-close.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Другой маршрут', exact: true }).click();
    await page.locator('[data-route-option="industrial-run"]').click();
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.race-route')?.textContent?.includes('Промышленный заезд'),
    );
    await page.screenshot({ path: out + '/industrial-environment.png' });
    report.screenshots = [
      'route-map',
      'straight-markings',
      'junction',
      'curved-markings',
      'car-close',
      'industrial-environment',
    ];
    await c.close();
  } else if (mode === 'camera') {
    const c = await context('medium', 0.5, 'camera'),
      page = await c.newPage();
    await openRace(page, 'midnight-sprint');
    await begin(page);
    const samples: Record<string, unknown>[] = [];
    report.samples = samples;
    const capture = async (target: number) => {
      await page.waitForFunction(
        (k) =>
          Math.abs(Number(document.querySelector('[data-testid="speed"]')?.textContent) - k) < 2,
        target,
        { timeout: 120000 },
      );
      const sample = await page.evaluate(() => {
        const c = document.querySelector('canvas')!,
          p = document.querySelector('[data-testid="race-player"]') as HTMLElement;
        return {
          kph: Number(document.querySelector('[data-testid="speed"]')?.textContent),
          height: Number(c.dataset.projectedCarHeight),
          distance: Number(c.dataset.cameraDistance),
          fov: Number(c.dataset.cameraFov),
          x: Number(p.dataset.x),
          z: Number(p.dataset.z),
          heading: Number(p.dataset.heading),
        };
      });
      samples.push({ targetKph: target, ...sample });
      await page.screenshot({ path: `${out}/camera-${target}.png` });
      const afterScreenshotKph = Number(await page.getByTestId('speed').textContent());
      Object.assign(samples.at(-1)!, { afterScreenshotKph });
      // GPU readback is asynchronous: retain both live speeds instead of
      // pretending the screenshot was taken at precisely the requested instant.
    };
    await capture(0);
    await installDriver(page, 'gamepad', 'single', 18);
    await page.waitForFunction(
      () => {
        const p = document.querySelector('[data-testid="race-player"]') as HTMLElement;
        return (
          Number(p.dataset.x) > -255 &&
          Number(p.dataset.x) < -100 &&
          Math.abs(Number(p.dataset.z) + 100) < 3
        );
      },
      null,
      { timeout: 180000 },
    );
    // Capture the fastest run first, leaving straight road for GPU readback.
    // Subsequent 100/50 km/h samples also verify braking with the same camera.
    for (const speed of [150, 100, 50]) {
      await page.evaluate((k) => {
        const w = window as unknown as {
          nexusDriverCruiseSpeed: number;
          nexusDriverNitro: boolean;
        };
        w.nexusDriverCruiseSpeed = k / 3.6;
        w.nexusDriverNitro = k >= 150;
      }, speed);
      await capture(speed);
    }
    const values = samples.map((s) => Number(s.height));
    const deviation = (Math.max(...values) - Math.min(...values)) / values[0];
    report.samples = samples.sort((a, b) => Number(a.targetKph) - Number(b.targetKph));
    report.measurement =
      'Projected bounding height of the loaded GLB, accompanied by actual gameplay screenshots and video; not a segmented pixel-silhouette measurement';
    report.relativeHeightDeviation = deviation;
    report.passed = deviation <= 0.05;
    if (deviation > 0.05) throw Error('Camera GLB projection exceeds 5 percent');
    await page.keyboard.press('Escape');
    const video = page.video();
    await c.close();
    if (video) await rename(await video.path(), out + '/camera-acceleration.webm');
  } else if (mode === 'video' || mode === 'routes') {
    const results: Record<string, unknown>[] = [];
    report.routes = results;
    const videoRoutes = process.env.NEXUS_QA_VIDEO_ROUTE
      ? cityRoutes.filter((r) => r.id === process.env.NEXUS_QA_VIDEO_ROUTE)
      : cityRoutes;
    if (!videoRoutes.length) throw Error('Unknown video route');
    for (const r of videoRoutes) {
      const recordingStarted = Date.now();
      const c = await context(
          mode === 'video' ? 'medium' : 'low',
          mode === 'video' ? 0.5 : 0.15,
          mode === 'video' ? r.id : undefined,
        ),
        page = await c.newPage();
      await openRace(page, r.id);
      await begin(page);
      const drivingStarted = Date.now();
      await page.evaluate((nitro) => {
        Object.assign(window, { nexusDriverNitro: nitro, qaPeakSpeed: 0, qaPeakImpact: 0 });
        window.addEventListener('nexus-simulation-tick', (event) => {
          const state = (event as CustomEvent).detail,
            w = window as unknown as { qaPeakSpeed: number; qaPeakImpact: number };
          w.qaPeakSpeed = Math.max(w.qaPeakSpeed, state.speed * 3.6);
          w.qaPeakImpact = Math.max(w.qaPeakImpact, state.collisionImpulse ?? 0);
        });
      }, process.env.NEXUS_QA_VIDEO_NITRO === '1');
      await installDriver(
        page,
        process.env.NEXUS_QA_VIDEO_INPUT === 'gamepad'
          ? 'gamepad'
          : r.id === 'industrial-run'
            ? 'keyboard'
            : 'gamepad',
        'single',
        mode === 'video' ? Number(process.env.NEXUS_QA_VIDEO_SPEED ?? 24) : undefined,
      );
      if (mode === 'routes')
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="race-player"]')?.getAttribute('data-lap') === '2',
          null,
          { timeout: 180000 },
        );
      else if (process.env.NEXUS_QA_VIDEO_SECONDS)
        await page.waitForTimeout(
          Math.min(60, Math.max(5, Number(process.env.NEXUS_QA_VIDEO_SECONDS))) * 1000,
        );
      else
        await page.waitForFunction(
          () =>
            Number(
              document.querySelector('[data-testid="checkpoint"]')?.textContent?.split('/')[0],
            ) >= 3,
          null,
          { timeout: 120000 },
        );
      const data = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="race-player"]') as HTMLElement;
        return {
          peakSpeedKmh: (window as unknown as { qaPeakSpeed?: number }).qaPeakSpeed,
          peakImpact: (window as unknown as { qaPeakImpact?: number }).qaPeakImpact,
          lap: r.dataset.lap,
          checkpoint: document.querySelector('[data-testid="checkpoint"]')?.textContent,
          x: r.dataset.x,
          z: r.dataset.z,
        };
      });
      await page.keyboard.press('Escape');
      const video = page.video();
      await c.close();
      if (video) await rename(await video.path(), `${out}/${r.id}.webm`);
      results.push({
        route: r.id,
        videoStartSeconds: (drivingStarted - recordingStarted) / 1000,
        renderQuality: mode === 'video' ? 'medium' : 'low',
        renderDpr: mode === 'video' ? 0.5 : 0.15,
        input:
          process.env.NEXUS_QA_VIDEO_INPUT === 'gamepad'
            ? 'virtual analog gamepad'
            : r.id === 'industrial-run'
              ? 'keyboard'
              : 'virtual analog gamepad',
        ...data,
      });
    }
    report.routes = results;
  } else throw Error('Use screens, routes, video or performance');
  report.passed = errors.length === 0;
  if (errors.length) process.exitCode = 1;
} catch (error) {
  await writeFile(
    '/tmp/nexus-city-qa-error-private.txt',
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    { mode: 0o600 },
  );
  report.passed = false;
  process.exitCode = 1;
  console.error('City QA failed; private diagnostics saved without printing credentials');
} finally {
  await browser.close();
  await writeFile(`${out}/${mode}-report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ mode, passed: report.passed, artifacts: out }));
}
