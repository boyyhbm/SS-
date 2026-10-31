import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { test, expect } from './fixtures';

test('admin uploads stay usable as catalog images without a filesystem volume', async ({
  page,
}) => {
  test.skip(process.env.NEXUS_MEDIA_STORE !== 'database', 'Database media mode only');
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const id = randomBytes(6).toString('hex');
  const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
  let file: string | undefined;
  let gameId: string | undefined;
  let userId: string | undefined;
  try {
    await page.goto('/register');
    await page.locator('[name="username"]').fill(`media_${id}`);
    await page.locator('[name="email"]').fill(`media_${id}@example.test`);
    await page.locator('[name="password"]').fill('Media QA password 2026');
    await page.locator('[name="confirmPassword"]').fill('Media QA password 2026');
    await page.getByRole('button', { name: 'Создать свой профиль' }).click();
    await expect(page).toHaveURL('/');
    const state = await (await page.request.get('/api/console')).json();
    userId = state.user.id;
    const image = await sharp({
      create: { width: 24, height: 16, channels: 3, background: '#334866' },
    })
      .png()
      .toBuffer();
    const upload = () =>
      page.request.post('/api/admin/images', {
        headers: { Origin: origin },
        multipart: { image: { name: 'fixture.png', mimeType: 'image/png', buffer: image } },
      });
    expect((await upload()).status()).toBe(403);
    await db.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    const uploaded = await upload();
    expect(uploaded.status()).toBe(200);
    const asset = await uploaded.json();
    file = asset.url.split('/').at(-1);
    expect(await db.uploadedImage.count({ where: { file } })).toBe(1);
    const game = {
      slug: `media-${id}`,
      title: 'Media persistence QA',
      description: 'An isolated test of persistent uploaded cover images.',
      descriptionEn: 'An isolated test of persistent uploaded cover images.',
      genre: 'racing',
      cover: asset.url,
      banner: asset.url,
      status: 'DRAFT',
      published: false,
      runtimeKey: 'midnight-outlaws',
      sortOrder: 9999,
    };
    const created = await page.request.post('/api/admin/games', {
      headers: { Origin: origin },
      data: game,
    });
    expect(created.status()).toBe(200);
    gameId = (await created.json()).id;
    expect((await db.game.findUniqueOrThrow({ where: { id: gameId } })).cover).toBe(asset.url);
    const missing = await page.request.post('/api/admin/games', {
      headers: { Origin: origin },
      data: { ...game, slug: `missing-${id}`, cover: `/api/media/${randomUUID()}.webp` },
    });
    expect(missing.status()).toBe(400);
    await page.goto(asset.url);
    await expect
      .poll(() => page.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(24);
    await page.reload();
    await expect
      .poll(() => page.locator('img').evaluate((img) => (img as HTMLImageElement).naturalHeight))
      .toBe(16);
  } finally {
    if (gameId) await db.game.delete({ where: { id: gameId } });
    if (file) await db.uploadedImage.deleteMany({ where: { file } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
