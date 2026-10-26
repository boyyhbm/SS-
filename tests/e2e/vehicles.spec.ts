import { test, expect } from './fixtures';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isolateRegistrationQuota } from '../helpers/registration-quota';
import { writeFile } from 'node:fs/promises';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const ids: string[] = [];
test.beforeAll(async () => isolateRegistrationQuota(db));
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'garageqa_' } } });
  await db.$disconnect();
});
test('Garage: six real models, 3D inspection, actual motion and durable selection', async ({
  page,
}) => {
  test.setTimeout(480000);
  const username = 'garageqa_' + randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
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
  const g = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws'),
    origin = new URL(page.url()).origin;
  await page.request.post('/api/library', {
    headers: { Origin: origin },
    data: { action: 'add', gameId: g.id },
  });
  expect(
    (
      await page.request.post('/api/garage', {
        headers: { Origin: origin },
        data: { vehicleId: 'invented', paint: 'silver' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post('/api/garage', {
        headers: { Origin: origin },
        data: { vehicleId: 'iron-v8', paint: 'silver', userId: 'other' },
      })
    ).status(),
  ).toBe(400);
  const models: { vehicleId: string; triangles: number; distance: number }[] = [];
  for (const vehicleId of [
    'meridian-r6',
    'pocket-gt',
    'iron-v8',
    'vector-rs',
    'apex-r',
    'nova-x',
  ]) {
    await page.goto('/play/midnight-outlaws');
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
      null,
      { timeout: 180000 },
    );
    if (vehicleId === 'meridian-r6') {
      await page.getByRole('button', { name: 'Открыть гараж', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-garage-option]')).toHaveCount(6);
      await dialog.locator('[data-garage-option="pocket-gt"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLCanvasElement>('.garage-viewer canvas')?.dataset
            .garageReady === 'true',
        null,
        { timeout: 60000 },
      );
      await dialog.getByRole('button', { name: 'Повернуть автомобиль вправо' }).click();
      await dialog.getByRole('button', { name: 'cyan', exact: true }).click();
      await expect(dialog.locator('meter')).toHaveCount(5);
      await page.screenshot({ path: 'test-results/garage.png' });
      await dialog.getByRole('button', { name: 'Выбрать автомобиль', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect
        .poll(async () => await (await page.request.get('/api/garage')).json())
        .toEqual({ vehicleId: 'pocket-gt', paint: 'cyan' });
    }
    await page.getByLabel('Автомобиль', { exact: true }).selectOption(vehicleId);
    await page.waitForFunction(
      (id) => document.querySelector('canvas')?.dataset.vehicle === id,
      vehicleId,
    );
    await expect
      .poll(async () => (await (await page.request.get('/api/garage')).json()).vehicleId)
      .toBe(vehicleId);
    const before = await page.getByTestId('race-player').evaluate((e) => ({
      x: Number(e.getAttribute('data-x')),
      z: Number(e.getAttribute('data-z')),
    }));
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await page.keyboard.down('KeyW');
    await page.waitForFunction((p) => {
      const e = document.querySelector<HTMLElement>('[data-testid=race-player]');
      return !!e && Math.hypot(Number(e.dataset.x) - p.x, Number(e.dataset.z) - p.z) > 6;
    }, before);
    await page.keyboard.up('KeyW');
    const after = await page.getByTestId('race-player').evaluate((e) => ({
      x: Number(e.getAttribute('data-x')),
      z: Number(e.getAttribute('data-z')),
    }));
    const triangles = await page
      .locator('canvas')
      .evaluate((e) => Number(e.dataset.modelTriangles));
    expect(triangles).toBeGreaterThan(500);
    models.push({
      vehicleId,
      triangles,
      distance: Math.hypot(after.x - before.x, after.z - before.z),
    });
    await page.keyboard.press('Escape');
  }
  expect(models).toHaveLength(6);
  expect(new Set(models.map((m) => m.triangles)).size).toBeGreaterThanOrEqual(4);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
    null,
    { timeout: 180000 },
  );
  await expect(page.getByLabel('Автомобиль', { exact: true })).toHaveValue('nova-x');
  await writeFile(
    'test-results/vehicles-functional.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        passed: true,
        scope:
          'Actual single-player WebGL models and keyboard movement; account-persisted selection; no pose injection',
        models,
      },
      null,
      2,
    ) + '\n',
  );
});
