import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
let userId = '';
test.afterAll(async () => {
  if (userId)
    await db.user.deleteMany({ where: { id: userId, username: { startsWith: 'assistqa_' } } });
  await db.$disconnect();
});
test('account-owned racing guide defaults to corners, toggles in UI and survives a reload', async ({
  page,
}) => {
  test.setTimeout(120000);
  const username = 'assistqa_' + randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
  await page.goto('/register');
  for (const [k, v] of Object.entries({
    username,
    email: username + '@example.test',
    password,
    confirmPassword: password,
  }))
    await page.locator(`[name="${k}"]`).fill(v);
  await page.locator('.auth-submit').click();
  await expect(page).toHaveURL('/');
  const origin = new URL(page.url()).origin;
  const d = await (await page.request.get('/api/console')).json();
  userId = d.user.id;
  const gameId = d.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws').id;
  expect(
    (
      await page.request.post('/api/library', {
        headers: { Origin: origin },
        data: { action: 'add', gameId },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/play/midnight-outlaws');
  await expect(page.locator('canvas')).toHaveAttribute('data-assets', 'glb-loaded', {
    timeout: 90000,
  });
  const select = page.getByLabel('Гоночная траектория', { exact: true });
  await expect(select).toHaveValue('corners');
  await select.selectOption('full');
  await expect(page.locator('canvas')).toHaveAttribute('data-racing-line', 'full');
  await expect
    .poll(async () => (await (await page.request.get('/api/racing-settings')).json()).racingLine)
    .toBe('full');
  await page.reload();
  await expect(select).toHaveValue('full');
  await select.selectOption('off');
  await expect(page.locator('canvas')).toHaveAttribute('data-racing-line', 'off');
  expect(
    (
      await page.request.post('/api/racing-settings', {
        headers: { Origin: origin },
        data: { racingLine: 'full', userId: 'foreign-user' },
      })
    ).ok(),
  ).toBe(false);
});
