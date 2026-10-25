import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import 'dotenv/config';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 1000 },
    // Optional reduced backing resolution for functional WebGL checks on GPU-less CI.
    // Performance captures use their own context at DPR 1 and report actual frame times.
    deviceScaleFactor: process.env.E2E_SOFTWARE_DPR ? Number(process.env.E2E_SOFTWARE_DPR) : 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ??
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: [
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  webServer:
    process.env.E2E_EXTERNAL_SERVER === '1'
      ? undefined
      : {
          command: 'npm run dev',
          url: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
        },
});
