import { installDriver } from '../helpers/race-driver';
import { virtualPad, pressPad } from './pad-helpers';
import sharp from 'sharp';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { uploadDirectory } from '../../src/lib/uploads';
import { createHash, randomBytes } from 'node:crypto';
const run = `qa_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const password = 'Nexus testing password 2026';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const errors: string[] = [];
async function register(page: Page, suffix: string) {
  const username = `qa_${randomBytes(6).toString('hex')}_${suffix.slice(0, 6)}`;
  const email = `${run}_${suffix}@example.test`;
  await page.goto('/register');
  await page.locator('[name="username"]').fill(username);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.locator('[name="confirmPassword"]').fill(password);
  await page.getByRole('button', { name: 'Создать свой профиль' }).click();
  await expect(page).toHaveURL('/');
  return { username, email };
}
async function post(page: Page, url: string, data: unknown) {
  return page.request.post(url, { headers: { Origin: origin }, data });
}
async function catalog(page: Page) {
  return (await (await page.request.get('/api/console')).json()).games as {
    id: string;
    slug: string;
  }[];
}
async function addGame(page: Page) {
  const game = (await catalog(page)).find((g) => g.slug === 'midnight-outlaws')!;
  const res = await post(page, '/api/library', { gameId: game.id, action: 'add' });
  expect(res.ok()).toBeTruthy();
  return game;
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: run } } });
  await db.game.deleteMany({ where: { slug: { startsWith: run.replaceAll('_', '-') } } });
  await db.$disconnect();
  expect(errors).toEqual([]);
});
test('A — real registration, empty library, discovery and add to Home', async ({ page }) => {
  await register(page, 'new');
  await expect(
    page.getByText('Твоя библиотека пока пуста.', { exact: false }).first(),
  ).toBeVisible();
  expect((await (await page.request.get('/api/console')).json()).library).toHaveLength(0);
  await page.locator('header nav').getByRole('link', { name: 'Открытия' }).click();
  await page.goto('/games/midnight-outlaws');
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать игру' })).toBeVisible();
  await page.locator('header nav').getByRole('link', { name: 'Главная' }).click();
  await expect(page.getByRole('heading', { name: 'Твоя коллекция' })).toBeVisible();
  expect((await (await page.request.get('/api/console')).json()).library).toHaveLength(1);
});
test('B — logout/login preserves library, favorite and settings', async ({ page }) => {
  const user = await register(page, 'back');
  await addGame(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'В избранное', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Убрать из избранного', exact: true }),
  ).toBeVisible();
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/login');
  await page.locator('[name="email"]').fill(user.email);
  await page.locator('[name="password"]').fill(password);
  await page.locator('[name="remember"]').check();
  await page.getByRole('button', { name: 'Войти в NEXUS' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/library');
  await expect(
    page.getByRole('button', { name: 'Убрать из избранного', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MIDNIGHT OUTLAWS' })).toBeVisible();
});
test('C — real WebGL, driving, pause and persistent launch history', async ({ page }) => {
  await register(page, 'race');
  await addGame(page);
  await page.goto('/play/midnight-outlaws');
  await expect(page.getByRole('button', { name: 'На старт', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'На старт', exact: true }).click();
  await expect(page.getByTestId('speed')).toHaveText('0');
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => Number(await page.getByTestId('speed').textContent()), { timeout: 10000 })
    .toBeGreaterThan(40);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Город подождёт.' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти в консоль', exact: true }).last().click();
  await expect(page).toHaveURL('/');
  const data = await (await page.request.get('/api/console')).json();
  expect(data.library[0].lastPlayedAt).toBeTruthy();
  expect(data.user.lastGame.slug).toBe('midnight-outlaws');
  const sessions = await db.gameSession.findMany({ where: { userId: data.user.id } });
  expect(sessions).toHaveLength(1);
  expect(sessions[0].endedAt).not.toBeNull();
});
test('D — separate accounts, forged identifiers and server authorization', async ({
  page,
  browser,
}) => {
  await register(page, 'accounta');
  const game = await addGame(page);
  const a = await (await page.request.get('/api/console')).json();
  const context = await browser.newContext();
  const other = await context.newPage();
  await register(other, 'accountb');
  expect((await (await other.request.get('/api/console')).json()).library).toHaveLength(0);
  await post(other, '/api/library', { action: 'remove', gameId: game.id, userId: a.user.id });
  expect((await (await page.request.get('/api/console')).json()).library).toHaveLength(1);
  expect(
    (
      await post(other, '/api/sessions', { action: 'start', gameId: game.id, userId: a.user.id })
    ).status(),
  ).toBe(403);
  expect((await post(other, '/api/admin/games', {})).status()).toBe(403);
  expect(
    (
      await page.request.post('/api/library', {
        headers: { Origin: 'https://evil.example' },
        data: { action: 'remove', gameId: game.id },
      })
    ).status(),
  ).toBe(403);
  const ownSession = await (
    await post(page, '/api/sessions', { action: 'start', gameId: game.id })
  ).json();
  expect(
    (
      await post(other, '/api/sessions', { action: 'end', sessionId: ownSession.sessionId })
    ).status(),
  ).toBe(404);
  expect(
    (
      await post(page, '/api/library', {
        action: 'add',
        gameId: game.id,
        padding: 'x'.repeat(40000),
      })
    ).status(),
  ).toBe(413);
  await context.close();
});
test('E — ADMIN creates, publishes, edits and safely deletes a catalog game', async ({ page }) => {
  const user = await register(page, 'admin');
  await db.user.update({ where: { email: user.email }, data: { role: 'ADMIN' } });
  await page.goto('/admin');
  const fixture = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#6b8cff' },
  })
    .png()
    .toBuffer();
  const upload = await page.request.post('/api/admin/images', {
    headers: { Origin: origin },
    multipart: { image: { name: 'qa.png', mimeType: 'image/png', buffer: fixture } },
  });
  expect(upload.ok()).toBeTruthy();
  const asset = await upload.json();
  expect(asset.url).toMatch(/^\/api\/media\/[a-f0-9-]+\.webp$/);
  const media = await page.request.get(asset.url);
  expect(media.headers()['content-type']).toBe('image/webp');
  if (process.env.NEXUS_MEDIA_STORE === 'database')
    await db.uploadedImage.delete({ where: { file: path.basename(asset.url) } });
  else await unlink(path.join(uploadDirectory(), path.basename(asset.url)));
  expect(
    (
      await page.request.post('/api/admin/images', {
        headers: { Origin: origin },
        multipart: {
          image: {
            name: 'fake.png',
            mimeType: 'image/png',
            buffer: Buffer.from('<script>alert(1)</script>'),
          },
        },
      })
    ).status(),
  ).toBe(400);
  await page.getByRole('button', { name: 'Новая игра', exact: true }).click();
  await page.locator('[name="title"]').fill('NEXUS QA CIRCUIT');
  await page.locator('[name="slug"]').fill(`${run.replaceAll('_', '-')}-circuit`);
  await page
    .getByLabel('Описание на русском')
    .fill('Проверочная оригинальная трасса для автоматизированного сценария.');
  await page
    .getByLabel('Описание на английском')
    .fill('An original circuit card for the automated test scenario.');
  await page.getByLabel('Игровой runtime').selectOption('midnight-outlaws');
  await page.getByLabel('Статус', { exact: true }).selectOption('AVAILABLE');
  await page.getByLabel('Опубликовано', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить игру', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить игру', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /NEXUS QA CIRCUIT/ })).toBeVisible();
  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'NEXUS QA CIRCUIT' })).toBeVisible();
  await page.goto('/admin');
  await page.getByRole('button', { name: /NEXUS QA CIRCUIT/ }).click();
  await page.getByLabel('Опубликовано', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Сохранить игру', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить игру', exact: true })).toHaveCount(0);
  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'NEXUS QA CIRCUIT' })).toHaveCount(0);
  await page.goto('/admin');
  await page.getByRole('button', { name: /NEXUS QA CIRCUIT/ }).click();
  await page.getByLabel('Опубликовано', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить игру', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить игру', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /NEXUS QA CIRCUIT/ }).click();
  await page.getByRole('button', { name: 'Удалить карточку', exact: true }).click();
  await page
    .locator('.controller-confirm-actions')
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /NEXUS QA CIRCUIT/ })).toHaveCount(0);
});
test('F — mobile registration, catalog and personal library without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, 'mobile');
  await page.goto('/discover');
  await page.goto('/games/midnight-outlaws');
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать игру' })).toBeVisible();
  await page.locator('header nav').getByRole('link', { name: 'Библиотека' }).click();
  await expect(page.getByRole('heading', { name: 'MIDNIGHT OUTLAWS' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('removing membership preserves saves and best lap on re-add', async ({ page }) => {
  await register(page, 'saves');
  const game = await addGame(page);
  const data = await (await page.request.get('/api/console')).json();
  await db.gameSave.create({
    data: {
      userId: data.user.id,
      gameId: game.id,
      saveKey: 'best-lap',
      saveData: { seconds: 22.54 },
    },
  });
  expect(
    (await post(page, '/api/library', { gameId: game.id, action: 'remove' })).ok(),
  ).toBeTruthy();
  let state = await (await page.request.get('/api/console')).json();
  expect(state.library).toHaveLength(0);
  expect(state.saves[0].saveData.seconds).toBe(22.54);
  await addGame(page);
  state = await (await page.request.get('/api/console')).json();
  expect(state.library).toHaveLength(1);
  expect(state.saves[0].saveData.seconds).toBe(22.54);
});
test('locale persists in PostgreSQL and recovery has no fictitious link', async ({ page }) => {
  await register(page, 'locale');
  await page.goto('/profile');
  await page.getByLabel('Язык интерфейса', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  const data = await (await page.request.get('/api/console')).json();
  expect(data.user.settings.language).toBe('en');
  await addGame(page);
  await page.goto('/play/midnight-outlaws');
  await expect(page.getByLabel('Graphics', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Art credits & licenses', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Architecture and vehicle');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  if (!process.env.SMTP_URL) {
    await page.goto('/recovery');
    await expect(page.getByRole('button', { name: 'Send recovery link' })).toBeDisabled();
    expect((await post(page, '/api/recovery', { email: data.user.email })).status()).toBe(503);
  }
});
test('database-backed login throttling and no unauthorized admin access', async ({ page }) => {
  await page.goto('/login');
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const email = `${run}_throttle@example.test`;
  for (let i = 0; i < 13; i++)
    await page.request.post('/api/auth/callback/credentials', {
      form: { csrfToken: csrf.csrfToken, email, password: 'wrong', json: 'true' },
      headers: { Origin: origin },
    });
  const row = await db.rateLimit.findUnique({
    where: { key: createHash('sha256').update(`login:${email}`).digest('hex') },
  });
  expect(row?.count).toBe(13);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
});

test('a complete lap through Gamepad API saves a real personal best', async ({ page }) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 960, height: 600 });
  await register(page, 'fullrace');
  await addGame(page);
  await page.goto('/play/midnight-outlaws');
  await expect(page.getByRole('button', { name: 'На старт', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'На старт', exact: true }).click();
  await installDriver(page, 'gamepad', 'single');
  await expect(page.getByTestId('race-player')).toHaveAttribute('data-lap', '2', {
    timeout: 100000,
  });
  await expect
    .poll(
      async () => {
        const data = await (await page.request.get('/api/console')).json();
        return data.saves[0]?.saveData.seconds ?? 0;
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(8);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.pause-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pause-overlay')).toHaveCount(0);
  }
  await expect(page).toHaveURL('/play/midnight-outlaws');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти в консоль', exact: true }).last().click();
  await expect(page).toHaveURL('/');
  const saved = await (await page.request.get('/api/console')).json();
  expect(saved.user.totalSeconds).toBeGreaterThan(0);
  const lapHistory = await db.gameSave.findUniqueOrThrow({
    where: {
      userId_gameId_saveKey: {
        userId: saved.user.id,
        gameId: saved.library[0].gameId,
        saveKey: 'lap-history:downtown-circuit',
      },
    },
  });
  expect(Array.isArray(lapHistory.saveData) && lapHistory.saveData.length > 0).toBe(true);
  await page.goto('/play/midnight-outlaws');
  await expect(page.getByRole('button', { name: 'Заезд на время', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Свободная тренировка', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Свободная тренировка', exact: true })).toHaveClass(
    'selected',
  );
  await page.locator('.personal-laps summary').click();
  await expect(page.locator('.personal-laps li').first()).toBeVisible();
});

test('password reset tokens expire, are single-use and revoke existing sessions', async ({
  page,
}) => {
  const user = await register(page, 'reset');
  const record = await db.user.findUniqueOrThrow({ where: { email: user.email } });
  const token = randomBytes(32).toString('hex');
  await db.passwordResetToken.create({
    data: {
      userId: record.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const newPassword = 'A replacement password 2026';
  expect((await post(page, '/api/reset', { token, password: newPassword })).ok()).toBeTruthy();
  expect((await post(page, '/api/reset', { token, password: newPassword })).status()).toBe(400);
  expect((await (await page.request.get('/api/console')).json()).user).toBeNull();
  const expired = randomBytes(32).toString('hex');
  await db.passwordResetToken.create({
    data: {
      userId: record.id,
      tokenHash: createHash('sha256').update(expired).digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  expect((await post(page, '/api/reset', { token: expired, password: newPassword })).status()).toBe(
    400,
  );
  await page.goto('/login');
  await page.locator('[name="email"]').fill(user.email);
  await page.locator('[name="password"]').fill(newPassword);
  await page.getByRole('button', { name: 'Войти в NEXUS' }).click();
  await expect(page).toHaveURL('/');
});

test('keyboard focus and gamepad Library/Back work inside console dialogs', async ({ page }) => {
  await virtualPad(page, 'NEXUS QA navigation pad');
  await register(page, 'navigate');
  await page.locator('header nav').getByRole('link', { name: 'Главная', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.locator('header nav').getByRole('link', { name: 'Открытия', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/discover');
  await expect(page.locator('.os-discover')).toBeVisible();
  await pressPad(page, 3);
  await expect(page).toHaveURL('/library');
  await page.getByRole('button', { name: 'Поиск игр', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await pressPad(page, 9);
  await expect(page).toHaveURL('/library');
  await expect(page.getByRole('dialog')).toBeVisible();
  await pressPad(page, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL('/library');
});
