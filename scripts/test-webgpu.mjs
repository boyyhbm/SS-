import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
await fs.mkdir('docs/graphics-next', { recursive: true });
const report = {
  date: new Date().toISOString(),
  physicalGpuAvailable: false,
  scope: 'Separate renderer compatibility probe, not gameplay or a GPU performance certification',
  attempts: [],
};
for (const experimental of [false, true]) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      ...(experimental ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] : []),
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } }),
      messages = [];
    page.on('console', (m) => {
      if (['warning', 'error'].includes(m.type())) messages.push(m.text().slice(0, 500));
    });
    page.on('pageerror', (e) => messages.push(e.message));
    await page.goto('http://127.0.0.1:3102/webgpu');
    await page.waitForFunction(() => window.webgpuProbe?.ready, null, { timeout: 120000 });
    const result = await page.evaluate(() => ({
      ...window.webgpuProbe,
      userAgent: navigator.userAgent,
      secureContext: isSecureContext,
    }));
    report.attempts.push({ experimentalSoftwareFlags: experimental, ...result, messages });
    console.log(
      JSON.stringify({
        experimental,
        backend: result.actualBackend,
        compatible: result.productionCompatible,
      }),
    );
  } catch (e) {
    report.attempts.push({ experimentalSoftwareFlags: experimental, error: e.message });
  } finally {
    await browser.close();
  }
}
report.decision =
  'Retain WebGL2 production fallback: full legacy GLSL/PMREM graph must pass compatibility and physical GPU benchmarks before a backend migration.';
await fs.writeFile('docs/graphics-next/webgpu-probe.json', JSON.stringify(report, null, 2) + '\n');
