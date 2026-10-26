// Real runtime capture. This tool changes only controls/UI settings, never car poses,
// checkpoints or results. Audio is tapped after the actual game's analyser.
import 'dotenv/config';
import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { db } from '../src/lib/db';
import { installDriver } from '../tests/helpers/race-driver';
import { vehicleIdSchema } from '../src/games/vehicles/config';
import { routeIdSchema } from '../src/games/route-registry';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3001',
  quality = process.argv[2] ?? 'high',
  mode = process.argv[3] ?? 'stills';
if (!['high', 'ultra', 'low'].includes(quality) || !['stills', 'video', 'garage'].includes(mode))
  throw Error('Use high|ultra|low stills|video|garage [routeIds] [vehicleId] [seconds]');
const routes = process.argv[4]?.split(',').map((id) => routeIdSchema.parse(id)) ?? [
  'downtown-circuit',
  'velocity-circuit',
  'eagle-ridge',
  'coastline-run',
];
const vehicleOverride = process.argv[5] ? vehicleIdSchema.parse(process.argv[5]) : undefined;
const captureSeconds = Math.max(6, Math.min(60, Number(process.argv[6] ?? 24)));
const suffix = vehicleOverride ? '-' + vehicleOverride : '';
const database = new URL(process.env.DATABASE_URL!);
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !/^\/nexus_gameplay_qa_[a-f0-9]{8}$/.test(database.pathname) ||
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
)
  throw Error('Isolated local QA only');
const out = 'public/reports/racing-experience',
  raw = 'storage/racing-experience';
await mkdir(out + '/images', { recursive: true });
await mkdir(out + '/clips', { recursive: true });
await mkdir(raw, { recursive: true });
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
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
// tsx preserves nested function names with an esbuild helper. Serialized
// Playwright input fixtures need that identity helper in the browser as well.
await context.addInitScript('globalThis.__name = (fn) => fn;');
await context.addInitScript(
  ({ quality }) => {
    localStorage.setItem(
      'nexus-render-quality',
      JSON.stringify({ state: { quality }, version: 0 }),
    );
    type CaptureWindow = Window & {
      experience: {
        stats: unknown[];
        audio: unknown;
        stream?: MediaStream;
        recorder?: MediaRecorder;
        chunks: Blob[];
      };
    };
    const w = window as unknown as CaptureWindow;
    w.experience = { stats: [], audio: null, chunks: [] };
    window.addEventListener('nexus-render-stats', (e) =>
      w.experience.stats.push((e as CustomEvent).detail),
    );
    window.addEventListener(
      'nexus-game-audio-telemetry',
      (e) => (w.experience.audio = (e as CustomEvent).detail),
    );
    const connect = AudioNode.prototype.connect as (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) => AudioNode | undefined;
    AudioNode.prototype.connect = function (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) {
      if (this instanceof AnalyserNode && destination === this.context.destination) {
        const capture = (this.context as AudioContext).createMediaStreamDestination();
        connect.call(this, capture);
        w.experience.stream = capture.stream;
      }
      if (destination instanceof AudioParam) return connect.call(this, destination, output);
      return connect.call(this, destination, output, input);
    } as typeof AudioNode.prototype.connect;
  },
  { quality },
);
const page = await context.newPage();
page.setDefaultTimeout(180000);
const errors: string[] = [],
  ids: string[] = [];
page.on('pageerror', (error) => errors.push(error.name));
const report = {
  date: new Date().toISOString(),
  quality,
  mode,
  viewport: [1280, 720],
  devicePixelRatio: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceUncommitted:
    execFileSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim()
      .length > 0,
  scope:
    'Actual NEXUS game runtime. Normal keyboard/Gamepad API fixture controls only. Canvas capture includes live game audio, not a prerecorded engine track. No pose injection or generated images.',
  host: {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    platform: os.platform(),
    gpu: '',
  },
  errors,
  scenes: [] as unknown[],
  passed: false,
};
try {
  const username = 'captureqa_' + randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
  await page.goto(origin + '/register');
  for (const [key, value] of Object.entries({
    username,
    email: username + '@example.test',
    password,
    confirmPassword: password,
  }))
    await page.locator(`[name="${key}"]`).fill(value);
  await page.locator('.auth-submit').click();
  await page.waitForURL(origin + '/');
  const data = await (await page.request.get(origin + '/api/console')).json();
  ids.push(data.user.id);
  const game = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws');
  await page.request.post(origin + '/api/library', {
    headers: { Origin: origin },
    data: { action: 'add', gameId: game.id },
  });
  await page.request.post(origin + '/api/racing-settings', {
    headers: { Origin: origin },
    data: { racingLine: 'full' },
  });
  for (const route of routes) {
    const sceneName = (vehicleOverride ? vehicleOverride + '-' : '') + route;
    console.log(JSON.stringify({ stage: 'loading', route, quality, mode }));
    await page.goto(origin + '/play/midnight-outlaws?developer=1&route=' + route);
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
    );
    if ((await page.getByTestId('race-player').getAttribute('data-route')) !== route) {
      await page.locator(`[data-route-option="${route}"]`).click();
      await page.waitForFunction(
        (id) =>
          document.querySelector('canvas')?.dataset.track === id &&
          document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
        route,
      );
    }
    await page
      .getByLabel('Автомобиль', { exact: true })
      .selectOption(
        vehicleOverride ??
          (route === 'coastline-run'
            ? 'nova-x'
            : route === 'eagle-ridge'
              ? 'pocket-gt'
              : 'meridian-r6'),
      );
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.race-canvas')!.dataset.instrumentation = 'true';
    });
    if ((route === 'downtown-circuit' && mode === 'stills') || mode === 'garage') {
      await page.getByRole('button', { name: 'Открыть гараж', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>('.garage-viewer canvas')?.dataset.garageReady ===
          'true',
      );
      await page.screenshot({ path: `${out}/images/garage-${quality}.png` });
      await page.getByRole('button', { name: 'Закрыть гараж', exact: true }).click();
      if (mode === 'garage') {
        report.scenes.push({
          route,
          screenshot: `images/garage-${quality}.png`,
          scope: 'Actual full-detail garage viewer; no gameplay performance claim',
        });
        break;
      }
    }
    const gpu = await page.locator('.race-canvas canvas').evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!,
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'UNAVAILABLE';
    });
    report.host.gpu = gpu;
    await installDriver(page, 'gamepad', 'single', route === 'coastline-run' ? 52 : 29);
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="speed"]')?.textContent) > 35,
    );
    if (mode === 'video') {
      await page.evaluate(() => {
        type Capture = Window & {
          experience: {
            stream?: MediaStream;
            recorder: MediaRecorder;
            chunks: Blob[];
            stats: unknown[];
          };
        };
        const w = window as unknown as Capture,
          canvas = document.querySelector<HTMLCanvasElement>('.race-canvas canvas')!;
        if (!w.experience.stream) throw Error('Real game audio tap is missing');
        const stream = new MediaStream([
          ...canvas.captureStream(30).getVideoTracks(),
          ...w.experience.stream.getAudioTracks(),
        ]);
        const recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp8,opus',
          videoBitsPerSecond: 5000000,
        });
        w.experience.recorder = recorder;
        w.experience.chunks = [];
        w.experience.stats = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) w.experience.chunks.push(e.data);
        };
        recorder.start(500);
      });
      await page.waitForTimeout(captureSeconds * 1000);
    } else {
      await page.waitForTimeout(6000);
    }
    await page.screenshot({ path: `${out}/images/${sceneName}-${quality}.png` });
    await page.keyboard.press('Escape');
    const measurement = await page.evaluate(() => {
      const w = window as unknown as { experience: { stats: unknown[]; audio: unknown } };
      return { stats: w.experience.stats, audio: w.experience.audio };
    });
    if (mode === 'video') {
      const base64 = await page.evaluate(async () => {
        const w = window as unknown as { experience: { recorder: MediaRecorder; chunks: Blob[] } };
        await new Promise<void>((resolve) => {
          w.experience.recorder.onstop = () => resolve();
          w.experience.recorder.stop();
        });
        const blob = new Blob(w.experience.chunks, { type: 'video/webm' });
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(blob);
        });
      });
      const source = `${raw}/${sceneName}-${quality}.webm`,
        destination = `${out}/clips/${sceneName}-${quality}.mp4`;
      await writeFile(source, Buffer.from(base64, 'base64'));
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart',
        destination,
      ]);
    }
    report.scenes.push({
      route,
      screenshot: `images/${sceneName}-${quality}.png`,
      ...(mode === 'video' ? { clip: `clips/${sceneName}-${quality}.mp4` } : {}),
      stats: measurement.stats,
      audio: measurement.audio,
    });
    console.log(
      JSON.stringify({ captured: route, quality, mode, samples: measurement.stats.length }),
    );
    await writeFile(
      `${out}/capture-${quality}-${mode}${suffix}.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  report.passed = errors.length === 0;
} catch (error) {
  // Playwright call logs may contain generated credentials or HTTP cookies.
  // Full diagnostics stay private; public evidence contains only the error class.
  await writeFile(
    `${raw}/capture-error-private.txt`,
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    { mode: 0o600 },
  );
  report.errors.push(error instanceof Error ? error.name : 'CaptureError');
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'captureqa_' } } });
  await db.$disconnect();
  await writeFile(
    `${out}/capture-${quality}-${mode}${suffix}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ passed: report.passed, scenes: report.scenes.length, errors: report.errors }),
  );
}
