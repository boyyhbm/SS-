import { test, expect } from './fixtures';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { defaultConfig } from '../../src/input/profiles';
import { hashPassword } from '../../src/lib/password';
import { virtualPad, pressPad, padButton, focusPad, activatePad, typeWithPad } from './pad-helpers';
const prefix = `pad_${randomBytes(3).toString('hex')}`,
  password = 'race_2026xx';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const errors: string[] = [];
test.afterAll(async () => {
  const users = await db.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  expect(errors).toEqual([]);
});
test('controller only: registration/OSK → catalog → library/context actions → race → restored focus', async ({
  page,
}) => {
  test.setTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await virtualPad(page);
  await page.goto('/');
  await activatePad(page, '.signin-link');
  await expect(page).toHaveURL(/\/login/);
  await activatePad(page, '.auth-switch a');
  await expect(page).toHaveURL(/\/register/);
  await typeWithPad(page, '[name="username"]', `${prefix}a`);
  await typeWithPad(page, '[name="email"]', `${prefix}a@e.test`);
  await typeWithPad(page, '[name="password"]', password);
  await typeWithPad(page, '[name="confirmPassword"]', password);
  await activatePad(page, '.auth-submit');
  await expect(page).toHaveURL('/');
  await pressPad(page, 5);
  await expect(page).toHaveURL('/discover');
  await focusPad(page, '.game-card:first-child .game-cover');
  await pressPad(page, 9);
  await expect(page.locator('.game-context-actions')).toBeVisible();
  await activatePad(page, '.game-context-actions button');
  await pressPad(page, 5);
  await expect(page).toHaveURL('/library');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await focusPad(page, '.game-cover');
  await pressPad(page, 9);
  await activatePad(page, '.game-context-actions button:nth-of-type(2)');
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/console')).json();
      return data.library[0]?.isFavorite;
    })
    .toBe(true);
  await focusPad(page, '.game-cover');
  await pressPad(page, 9);
  await activatePad(page, '.game-context-actions button:last-child');
  await expect(page.locator('.controller-confirm-actions')).toBeVisible();
  await activatePad(page, '.controller-confirm-actions .primary');
  await expect(page.locator('.game-card')).toHaveCount(0);
  await pressPad(page, 4);
  await expect(page).toHaveURL('/discover');
  await focusPad(page, '.game-card:first-child .game-cover');
  await pressPad(page, 9);
  await activatePad(page, '.game-context-actions button');
  await pressPad(page, 5);
  await expect(page).toHaveURL('/library');
  await activatePad(page, '.game-cover');
  await expect(page).toHaveURL('/games/midnight-outlaws');
  await activatePad(page, '.hero-actions button.primary');
  await expect(page).toHaveURL('/play/midnight-outlaws');
  await expect(page.locator('.pause-card .primary')).toBeEnabled();
  await activatePad(page, '.pause-card .primary');
  await padButton(page, 7, 0.4);
  await expect
    .poll(async () => Number(await page.locator('canvas').getAttribute('data-throttle')))
    .toBeCloseTo(0.4, 1);
  await expect
    .poll(async () => Number(await page.getByTestId('speed').textContent()))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const t = (window as unknown as { nexusTestPads: { pads: { axes: number[] }[] } })
      .nexusTestPads;
    t.pads[0].axes[0] = 0.6;
  });
  await expect
    .poll(async () => Number(await page.locator('canvas').getAttribute('data-steer')))
    .toBeGreaterThan(0.4);
  await padButton(page, 6, 0.3);
  await expect
    .poll(async () => Number(await page.locator('canvas').getAttribute('data-brake')))
    .toBeCloseTo(0.3, 1);
  await padButton(page, 2, 1);
  await expect(page.locator('canvas')).toHaveAttribute('data-handbrake', 'true');
  await padButton(page, 2, 0);
  await padButton(page, 1, 1);
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-mode', '1');
  await padButton(page, 1, 0);
  await padButton(page, 7, 0);
  await padButton(page, 6, 0);
  await page.evaluate(() => {
    (
      window as unknown as { nexusTestPads: { pads: { axes: number[] }[] } }
    ).nexusTestPads.pads[0].axes = [0, 0, 0, 0];
  });
  await padButton(page, 9, 1);
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await padButton(page, 9, 0);
  await expect(page.locator('html')).toHaveAttribute('data-controller-released', 'true');
  await pressPad(page, 9);
  await expect(page.locator('.pause-overlay')).toHaveCount(0);
  await page.evaluate(() => {
    const t = (window as unknown as { nexusTestPads: { connected: boolean } }).nexusTestPads;
    t.connected = false;
  });
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await expect(page.getByText(/Контроллер отключён/).first()).toBeVisible();
  await page.evaluate(() => {
    const t = (
      window as unknown as {
        nexusTestPads: {
          connected: boolean;
          pads: {
            axes: number[];
            buttons: { value: number; pressed: boolean; touched: boolean }[];
          }[];
        };
      }
    ).nexusTestPads;
    t.connected = true;
    t.pads[0].axes = [0, 0, 0, 0];
    t.pads[0].buttons = t.pads[0].buttons.map(() => ({ value: 0, pressed: false, touched: false }));
  });
  await expect(
    page.getByText('Контроллер подключён · DualSense virtual test', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-controller-released', 'true');
  await activatePad(page, '.pause-exit');
  await expect(page).toHaveURL('/library');
  await expect(page.locator('.game-cover')).toBeFocused();
  await activatePad(page, 'a[href="/profile"]');
  await activatePad(page, '.signout-button');
  await expect(page).toHaveURL('/');
  await activatePad(page, '.signin-link');
  await typeWithPad(page, '[name="email"]', `${prefix}a@e.test`);
  await typeWithPad(page, '[name="password"]', password);
  await activatePad(page, '.auth-submit');
  await expect(page).toHaveURL('/');
});
test('device discovery, input hints, saved remapping/profiles and ownership', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await virtualPad(page, 'Xbox virtual test');
  await page.goto('/controllers');
  await focusPad(page, '.controller-range input');
  await pressPad(page, 15);
  await expect(page.getByTestId('deadzone-value')).toHaveText('16%');
  await activatePad(page, '.controller-toggle input');
  await expect(page.getByLabel('Инверсия руля', { exact: true })).toBeChecked();
  // Guest calibration survives navigation and the first sign-in without creating a fake account.
  await activatePad(page, '.signin-link');
  await activatePad(page, '.auth-switch a');
  await page.locator('[name="username"]').fill(`${prefix}b`);
  await page.locator('[name="email"]').fill(`${prefix}b@e.test`);
  await page.locator('[name="password"]').fill(password);
  await page.locator('[name="confirmPassword"]').fill(password);
  await page.getByRole('button', { name: 'Создать свой профиль' }).click();
  await expect(page).toHaveURL('/');
  await activatePad(page, '.controller-nav-link');
  await expect(page.getByLabel('Инверсия руля', { exact: true })).toBeChecked();
  await expect(page.getByText('Xbox virtual test', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/controllers.png', fullPage: true });
  await pressPad(page, 13);
  await expect(page.locator('html')).toHaveAttribute('data-input-method', 'gamepad');
  await expect(page.locator('.controller-hints')).toContainText('A');
  await page.mouse.move(120, 160);
  await page.mouse.move(200, 170);
  await expect(page.locator('html')).toHaveAttribute('data-input-method', 'mouse');
  await page.evaluate(() => {
    (
      window as unknown as { nexusTestPads: { pads: { axes: number[] }[] } }
    ).nexusTestPads.pads[0].axes[0] = 0.06;
  });
  await page.waitForTimeout(120);
  await expect(page.locator('html')).toHaveAttribute('data-input-method', 'mouse');
  await page.getByLabel('Название профиля').fill('Precision');
  await page.getByLabel('Мёртвая зона', { exact: true }).fill('0.23');
  await page.getByLabel('Чувствительность руля').fill('1.35');
  await page.getByLabel('Инверсия руля', { exact: true }).check();
  const boost = page
    .locator('.controller-binding')
    .filter({ has: page.locator('strong', { hasText: 'Нитро' }) });
  await boost.getByRole('button', { name: 'Переназначить' }).click();
  await page.waitForTimeout(120);
  await padButton(page, 5, 1);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await padButton(page, 5, 0);
  await expect(boost.getByLabel(/index/)).toHaveValue('5');
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await expect(page.getByText('Профиль сохранён в аккаунте')).toBeVisible();
  const saved = await (await page.request.get('/api/controllers')).json();
  expect(saved.profiles).toHaveLength(1);
  expect(saved.profiles[0].config.bindings.boost.index).toBe(5);
  expect(saved.profiles[0].config.deadZone).toBe(0.23);
  await page.reload();
  await expect(page.getByLabel('Название профиля')).toHaveValue('Precision');
  await expect(page.getByTestId('deadzone-value')).toHaveText('23%');
  await page.getByRole('button', { name: 'Новый профиль' }).click();
  await page.getByLabel('Название профиля').fill('Comfort');
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/controllers')).json()).profiles.length)
    .toBe(2);
  const foreign = await db.user.create({
    data: {
      username: `${prefix}f`,
      email: `${prefix}f@e.test`,
      passwordHash: await hashPassword(password),
    },
  });
  const foreignProfile = await db.controllerProfile.create({
    data: { userId: foreign.id, name: 'Foreign', config: defaultConfig() },
  });
  for (const action of ['delete', 'activate'])
    expect(
      (
        await page.request.post('/api/controllers', {
          headers: { Origin: 'http://localhost:3000' },
          data: { action, id: foreignProfile.id },
        })
      ).status(),
    ).toBe(403);
  expect(await db.controllerProfile.count({ where: { id: foreignProfile.id } })).toBe(1);
  const unauth = await browser.newContext(),
    other = await unauth.newPage();
  await other.goto('/');
  expect((await other.request.get('/api/controllers')).status()).toBe(401);
  await unauth.close();
  await page.getByRole('button', { name: 'Проверить вибрацию' }).click();
  await expect(page.getByText(/Вибрация недоступна/)).toBeVisible();
  await page.evaluate(() => {
    const t = (window as unknown as { nexusTestPads: { pads: unknown[] } }).nexusTestPads;
    t.pads.push({
      id: 'Switch Pro virtual',
      mapping: 'standard',
      index: 1,
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ value: 0, pressed: false })),
      timestamp: 0,
    });
  });
  await expect(page.getByText('Switch Pro virtual', { exact: true })).toBeVisible();
  await page
    .locator('.controller-device')
    .filter({ hasText: 'Switch Pro virtual' })
    .getByRole('button', { name: 'Использовать' })
    .click();
  await expect(page.locator('.controller-device.selected')).toContainText('Switch Pro virtual');
  await context.close();
});
