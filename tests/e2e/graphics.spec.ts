import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const ids: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'graphicsqa_' } } });
  await db.$disconnect();
});
for (const requested of ['auto', 'medium'])
  test(`Graphics ${requested}: actual scene and strict application CSP`, async ({ page }) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (
        m.type() === 'error' &&
        /THREE|shader|WebGL|Content Security Policy|unsafe-eval/.test(m.text())
      )
        errors.push(m.text());
    });
    await page.addInitScript(
      (q) =>
        localStorage.setItem(
          'nexus-render-quality',
          JSON.stringify({ state: { quality: q }, version: 0 }),
        ),
      requested,
    );
    const username = 'graphicsqa_' + randomBytes(5).toString('hex'),
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
    const game = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws'),
      origin = new URL(page.url()).origin;
    expect(
      (
        await page.request.post('/api/library', {
          headers: { Origin: origin },
          data: { action: 'add', gameId: game.id },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/play/midnight-outlaws');
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.assets === 'glb-loaded',
      null,
      { timeout: 240000 },
    );
    const sample = await page.locator('canvas').evaluate((c) => ({
      quality: c.dataset.quality,
      calibration: JSON.parse(c.dataset.calibration ?? 'null'),
      format: c.dataset.assetFormat,
    }));
    if (requested === 'auto') {
      expect(sample.calibration.samplesMs.length).toBeGreaterThanOrEqual(2);
      expect(sample.calibration.samplesMs.length).toBeLessThanOrEqual(8);
      expect(sample.calibration.samplesMs.every((x: number) => Number.isFinite(x) && x > 0)).toBe(
        true,
      );
      expect(sample.quality).toBe(sample.calibration.selected);
    } else {
      expect(sample.quality).toBe('medium');
      expect(sample.format).toContain('KTX2');
    }
    const mainPolicy = (await page.request.get('/play/midnight-outlaws')).headers()[
      'content-security-policy'
    ];
    expect(mainPolicy).not.toContain("'unsafe-eval'");
    expect(sample.format).toContain('Meshopt');
    expect(errors).toEqual([]);
    await expect(page.locator('[data-route-option="downtown-circuit"]')).toBeVisible();
  });
