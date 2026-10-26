import { test, expect } from './fixtures';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isolateRegistrationQuota } from '../helpers/registration-quota';
import { installDriver } from '../helpers/race-driver';
import { trackRegistry } from '../../src/games/tracks/registry';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const users: string[] = [];
test.beforeAll(async () => isolateRegistrationQuota(db));
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users }, username: { startsWith: 'trackqa_' } } });
  await db.$disconnect();
});
test('Designed circuit and mountain: actual WebGL, controls, elevation, checkpoints and saved laps', async ({
  page,
}) => {
  test.setTimeout(720000);
  const name = 'trackqa_' + randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
  await page.goto('/register');
  for (const [key, value] of Object.entries({
    username: name,
    email: name + '@example.test',
    password,
    confirmPassword: password,
  }))
    await page.locator(`[name="${key}"]`).fill(value);
  await page.locator('.auth-submit').click();
  await expect(page).toHaveURL('/');
  const consoleData = await (await page.request.get('/api/console')).json();
  users.push(consoleData.user.id);
  const game = consoleData.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws'),
    origin = new URL(page.url()).origin;
  await page.request.post('/api/library', {
    headers: { Origin: origin },
    data: { action: 'add', gameId: game.id },
  });
  const evidence: unknown[] = [];
  await mkdir('test-results/tracks', { recursive: true });
  for (const track of trackRegistry) {
    await page.goto('/play/midnight-outlaws');
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
      null,
      { timeout: 180000 },
    );
    await page.locator(`[data-route-option="${track.trackId}"]`).click();
    await expect(page.getByTestId('race-player')).toHaveAttribute('data-route', track.trackId);
    await page.waitForFunction(
      () =>
        document.querySelector('canvas')?.dataset.assets === 'glb-loaded' &&
        !document.querySelector('.player-loading'),
      null,
      { timeout: 180000 },
    );
    if (track.kind === 'circuit') await page.getByLabel('Круги', { exact: true }).selectOption('1');
    await expect(
      page.locator(`[data-testid="road-network-map"][data-track="${track.trackId}"]`),
    ).toBeVisible();
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.race-canvas');
      if (host) host.dataset.instrumentation = 'true';
      const w = window as unknown as {
        trackQa: { minY: number; maxY: number; maxSpeed: number; steps: number };
      };
      w.trackQa = { minY: Infinity, maxY: -Infinity, maxSpeed: 0, steps: 0 };
      window.addEventListener('nexus-simulation-tick', (event) => {
        const s = (event as CustomEvent).detail;
        w.trackQa.minY = Math.min(w.trackQa.minY, s.y ?? 0);
        w.trackQa.maxY = Math.max(w.trackQa.maxY, s.y ?? 0);
        w.trackQa.maxSpeed = Math.max(w.trackQa.maxSpeed, s.speed);
        w.trackQa.steps++;
      });
    });
    await installDriver(page, track.kind === 'circuit' ? 'keyboard' : 'gamepad', 'single', 24);
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await expect
      .poll(async () => Number(await page.getByTestId('speed').textContent()), { timeout: 30000 })
      .toBeGreaterThan(20);
    await page.screenshot({ path: `test-results/tracks/${track.trackId}.png` });
    await expect
      .poll(async () => Number(await page.getByTestId('race-player').getAttribute('data-lap')), {
        timeout: 300000,
      })
      .toBeGreaterThan(1);
    const stats = (await page.evaluate(
      () => (window as unknown as { trackQa: unknown }).trackQa,
    )) as { minY: number; maxY: number; maxSpeed: number; steps: number };
    if (track.environment === 'mountain') expect(stats.maxY - stats.minY).toBeGreaterThan(80);
    expect(stats.steps).toBeGreaterThan(100);
    await expect
      .poll(
        async () => {
          const save = await db.gameSave.findUnique({
            where: {
              userId_gameId_saveKey: {
                userId: consoleData.user.id,
                gameId: game.id,
                saveKey: 'best-lap:' + track.trackId,
              },
            },
          });
          return !!save;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    evidence.push({
      trackId: track.trackId,
      trackVersion: track.trackVersion,
      lengthMeters: track.length,
      input: track.kind === 'circuit' ? 'keyboard' : 'Gamepad API fixture',
      completed: true,
      stats,
    });
  }
  await writeFile(
    'test-results/tracks-functional.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scope:
          'Real browser rendering and normalized input. No pose injection. Synthetic Gamepad API fixture; no physical controller certification.',
        tracks: evidence,
      },
      null,
      2,
    ) + '\n',
  );
});
