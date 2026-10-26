import { test, expect } from './fixtures';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isolateRegistrationQuota } from '../helpers/registration-quota';
import { defaultAudioSettings } from '../../src/games/audio/config';
import { writeFile } from 'node:fs/promises';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const ids: string[] = [];
test.beforeAll(async () => isolateRegistrationQuota(db));
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'audioqa_' } } });
  await db.$disconnect();
});
test('Audio: real context, engine response, mute, durable account settings and isolation', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const username = 'audioqa_' + randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
  await page.addInitScript(() => {
    const w = window as unknown as { audioSamples: Record<string, number | string>[] };
    w.audioSamples = [];
    window.addEventListener('nexus-game-audio-telemetry', (e) => {
      const sample = (e as CustomEvent).detail;
      if (sample) {
        w.audioSamples.push(sample);
        if (w.audioSamples.length > 250) w.audioSamples.shift();
      }
    });
  });
  await page.goto('/register');
  for (const [name, value] of Object.entries({
    username,
    email: username + '@example.test',
    password,
    confirmPassword: password,
  }))
    await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('.auth-submit').click();
  await expect(page).toHaveURL('/');
  const data = await (await page.request.get('/api/console')).json();
  ids.push(data.user.id);
  const game = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws'),
    origin = new URL(page.url()).origin;
  expect((await page.request.get('/api/game-audio')).ok()).toBe(true);
  expect(await (await page.request.get('/api/game-audio')).json()).toEqual(defaultAudioSettings);
  expect(
    (
      await page.request.post('/api/game-audio', {
        headers: { Origin: origin },
        data: { ...defaultAudioSettings, userId: 'other' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post('/api/game-audio', {
        headers: { Origin: 'https://foreign.example' },
        data: defaultAudioSettings,
      })
    ).status(),
  ).toBe(403);
  await page.request.post('/api/library', {
    headers: { Origin: origin },
    data: { action: 'add', gameId: game.id },
  });
  await page.goto('/play/midnight-outlaws');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
    null,
    { timeout: 180000 },
  );
  await page
    .locator('.race-canvas')
    .evaluate((e) => ((e as HTMLElement).dataset.instrumentation = 'true'));
  await page.getByRole('button', { name: 'На старт', exact: true }).click();
  await page.waitForFunction(() =>
    (window as unknown as { audioSamples: { status: string; rms: number }[] }).audioSamples.some(
      (s) => s.status === 'running' && s.rms > 0.001,
    ),
  );
  const idle = await page.evaluate(
    () => (window as unknown as { audioSamples: { rpm: number }[] }).audioSamples.at(-1)?.rpm ?? 0,
  );
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    () =>
      (window as unknown as { audioSamples: { shifts: number; rpm: number }[] }).audioSamples.some(
        (s) => s.shifts > 0 && s.rpm > 3000,
      ),
    null,
    { timeout: 30000 },
  );
  await page.keyboard.up('KeyW');
  const running = await page.evaluate(
    () =>
      (
        window as unknown as {
          audioSamples: {
            rpm: number;
            peak: number;
            voices: number;
            status: string;
            shifts: number;
          }[];
        }
      ).audioSamples,
  );
  expect(Math.max(...running.map((s) => s.rpm))).toBeGreaterThan(idle + 1500);
  expect(Math.max(...running.map((s) => s.peak))).toBeLessThan(0.99);
  expect(running.filter((s) => s.status === 'running').every((s) => s.voices === 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('.game-audio-settings summary').click();
  await page.getByRole('checkbox', { name: 'Выключить весь звук' }).check();
  await expect
    .poll(async () => (await (await page.request.get('/api/game-audio')).json()).muted)
    .toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () =>
      (window as unknown as { audioSamples: { rms: number }[] }).audioSamples.at(-1)!.rms < 0.0001,
  );
  const other = await browser.newContext();
  const p = await other.newPage();
  expect((await p.request.get(origin + '/api/game-audio')).status()).toBe(401);
  const second = 'audioqa_' + randomBytes(5).toString('hex');
  await p.goto(origin + '/register');
  for (const [name, value] of Object.entries({
    username: second,
    email: second + '@example.test',
    password,
    confirmPassword: password,
  }))
    await p.locator(`[name="${name}"]`).fill(value);
  await p.locator('.auth-submit').click();
  await expect(p).toHaveURL(origin + '/');
  ids.push((await (await p.request.get(origin + '/api/console')).json()).user.id);
  expect(await (await p.request.get(origin + '/api/game-audio')).json()).toEqual(
    defaultAudioSettings,
  );
  await other.close();
  await page.reload();
  expect((await (await page.request.get('/api/game-audio')).json()).muted).toBe(true);
  await writeFile(
    'test-results/audio-functional.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        passed: true,
        scope:
          'Actual authenticated game runtime, pointer start and keyboard throttle; Web Audio analyser output; software graphics at declared functional DPR',
        checks: [
          'Engine audible after real start interaction',
          'RPM rises on throttle',
          'Gear shift occurs during acceleration',
          'Measured output remains below clipping',
          'Mute silences output',
          'Volume settings survive reload',
          'Second account retains separate defaults',
          'Anonymous settings access rejected',
          'Foreign origin and userId injection rejected',
        ],
        idleRPM: idle,
        maximumRPM: Math.max(...running.map((s) => s.rpm)),
        maximumPeak: Math.max(...running.map((s) => s.peak)),
        shifts: Math.max(...running.map((s) => s.shifts)),
        physicalSpeakersOrHeadphonesTested: false,
        sourceRecordings: false,
      },
      null,
      2,
    ) + '\n',
  );
});
