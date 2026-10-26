import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const label = process.argv[2] ?? 'before',
  tier = process.env.GRAPHICS_TIER ?? 'high',
  out = process.env.GRAPHICS_OUTPUT ?? `docs/graphics-next/${label}/${tier}`;
if (!['before', 'after'].includes(label)) throw Error('Use before or after');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('PAGE_ERROR', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text());
    console.log('CONSOLE_ERROR', m.text().slice(0, 1200));
  }
});
const report = {
  date: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  kind: 'Actual Three.js graphics fixtures, synthetic visual car poses; NOT gameplay or multiplayer proof',
  viewport: [1280, 720],
  deviceScaleFactor: 1,
  tier,
  renderMode: 'Fixed pose, two actual draws on demand; intervals are not gameplay FPS',
  sourceUncommitted:
    execFileSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim()
      .length > 0,
  errors,
  scenes: [],
};
try {
  await page.goto('http://127.0.0.1:3102/?capture=1&tier=' + tier, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.graphicsLab?.ready);
  for (const [name, count] of [
    ['showcase', 1],
    ['downtown', 1],
    ['speed', 1],
    ['corner', 1],
    ['multiplayer', 1],
    ['multiplayer', 2],
    ['multiplayer', 4],
    ['multiplayer', 6],
  ].filter(
    ([name]) =>
      !process.env.GRAPHICS_SCENES || process.env.GRAPHICS_SCENES.split(',').includes(name),
  )) {
    await page.evaluate(({ name, count }) => window.graphicsLab.select(name, count), {
      name,
      count,
    });
    await page.waitForFunction(
      (n) => window.graphicsLab.frames.length >= n,
      Number(process.env.GRAPHICS_FRAME_SAMPLES ?? 1),
    );
    const sample = await page.evaluate(() => {
      const g = document.querySelector('canvas').getContext('webgl2'),
        e = g.getExtension('WEBGL_debug_renderer_info');
      return {
        ...window.graphicsLab,
        select: undefined,
        gpu: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown',
      };
    });
    const file = `${name}-${count}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    report.scenes.push({
      name,
      cars: count,
      file,
      frameIntervalsMs: sample.frames,
      drawCalls: sample.calls,
      triangles: sample.triangles,
      gpu: sample.gpu,
    });
    console.log(JSON.stringify({ label, scene: name, cars: count, calls: sample.calls }));
  }
  report.passed = errors.length === 0;
} catch (e) {
  report.passed = false;
  report.error = e.message;
  process.exitCode = 1;
} finally {
  await browser.close();
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
