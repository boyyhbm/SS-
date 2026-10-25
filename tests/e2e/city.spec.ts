import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { installDriver } from '../helpers/race-driver';
import { cityRoutes } from '../../src/games/road-network';
const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  }),
  ids: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'citycheck_' } } });
  await db.$disconnect();
});
for (const route of cityRoutes)
  test(`city network: ${route.id} → ordered finish → route-owned save`, async ({ page }) => {
    test.setTimeout(220000);
    const username = 'citycheck_' + randomBytes(4).toString('hex'),
      password = randomBytes(18).toString('hex');
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
    const game = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws');
    const origin = new URL(page.url()).origin;
    expect(
      (
        await page.request.post('/api/library', {
          headers: { Origin: origin },
          data: { action: 'add', gameId: game.id },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/play/midnight-outlaws');
    await page.locator(`[data-route-option="${route.id}"]`).click();
    await page.getByRole('button', { name: 'На старт', exact: true }).click();
    await installDriver(page, route.id === 'industrial-run' ? 'keyboard' : 'gamepad', 'single');
    await expect(page.getByTestId('race-player')).toHaveAttribute('data-lap', '2', {
      timeout: 180000,
    });
    await expect
      .poll(async () => {
        const d = await (await page.request.get('/api/console')).json();
        return d.saves.some(
          (s: { saveKey: string; saveData: { seconds: number } }) =>
            s.saveKey === `best-lap:${route.id}` && s.saveData.seconds > 8,
        );
      })
      .toBe(true);
    if (route.kind === 'sprint') {
      await expect(page.locator('.route-finish-overlay')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Выбрать маршрут', exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.route-selection')).toBeVisible();
    } else {
      await page.keyboard.press('Escape');
      await expect(page.locator('.pause-overlay')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Выйти в консоль', exact: true }).last().click();
    await expect(page).toHaveURL('/');
    expect(
      (await (await page.request.get('/api/console')).json()).library[0].lastPlayedAt,
    ).toBeTruthy();
  });
