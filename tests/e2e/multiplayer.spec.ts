import { installDriver } from '../helpers/race-driver';
import { virtualPad, activatePad, typeWithPad, padButton, pressPad } from './pad-helpers';
import { test, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prefix = `multi_${randomBytes(5).toString('hex')}`;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const password = 'Nexus real online test password';
const errors: string[] = [];
async function register(page: Page, suffix: string) {
  const username = `${prefix}_${suffix}`;
  await page.goto('/register');
  await page.locator('[name="username"]').fill(username);
  await page.locator('[name="email"]').fill(`${username}@example.test`);
  await page.locator('[name="password"]').fill(password);
  await page.locator('[name="confirmPassword"]').fill(password);
  await page.getByRole('button', { name: 'Создать свой профиль' }).click();
  await expect(page).toHaveURL('/');
  const data = await (await page.request.get('/api/console')).json();
  const game = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws');
  expect((await post(page, '/api/library', { action: 'add', gameId: game.id })).ok()).toBeTruthy();
  return { username, id: data.user.id, game };
}
function post(page: Page, path: string, data: unknown) {
  return page.request.post(path, { headers: { Origin: origin }, data });
}

test.afterAll(async () => {
  const ids = (
    await db.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } })
  ).map((u) => u.id);
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  expect(errors).toEqual([]);
});
test('real accounts → friends → party → private invitation → synchronized WebGL race → results → rematch', async ({
  browser,
}) => {
  test.setTimeout(600000);
  const ca = await browser.newContext({
      viewport: { width: 960, height: 650 },
      deviceScaleFactor: Number(process.env.E2E_SOFTWARE_DPR ?? 1),
      reducedMotion: 'reduce',
    }),
    cb = await browser.newContext({
      viewport: { width: 960, height: 650 },
      deviceScaleFactor: Number(process.env.E2E_SOFTWARE_DPR ?? 1),
      reducedMotion: 'reduce',
    }),
    cc = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const a = await ca.newPage(),
    b = await cb.newPage(),
    c = await cc.newPage();
  [a, b, c].forEach((p) => p.on('pageerror', (e) => errors.push(e.message)));
  try {
    await virtualPad(a);
    const A = await register(a, 'a'),
      B = await register(b, 'b');
    await register(c, 'c');
    await a.goto('/friends');
    await typeWithPad(a, '.people-search input', B.username);
    await activatePad(a, '.people-search button');
    await activatePad(a, '.people-results button.button');
    await b.goto('/friends');
    await b
      .locator('.social-section')
      .filter({ has: b.getByRole('heading', { name: 'Запросы в друзья' }) })
      .getByRole('button', { name: 'Принять' })
      .click();
    await expect(a.locator('.friend-card').filter({ hasText: B.username })).toBeVisible();
    await activatePad(a, '.party-empty button');
    await activatePad(a, '.friend-card button.button');
    await expect(
      b.locator('.invite-card').filter({ hasText: 'Приглашение в группу' }),
    ).toBeVisible();
    await b.locator('.invite-card').getByRole('button', { name: 'Принять', exact: true }).click();
    await expect(a.locator('.party-members .person-row')).toHaveCount(2);
    await a.locator('.party-members').getByRole('button', { name: 'Передать лидерство' }).click();
    await expect(
      b
        .locator('.party-members .person-row')
        .filter({ hasText: B.username })
        .locator('.leader-badge'),
    ).toBeVisible();
    let social = await (await b.request.get('/api/social')).json();
    expect(social.party.leaderId).toBe(B.id);
    await b.locator('.party-members').getByRole('button', { name: 'Передать лидерство' }).click();
    await expect(
      a
        .locator('.party-members .person-row')
        .filter({ hasText: A.username })
        .locator('.leader-badge'),
    ).toBeVisible();
    // A stranger cannot invite into a party or accept somebody else's invitation.
    expect((await post(c, '/api/social', { action: 'partyInvite', userId: A.id })).status()).toBe(
      403,
    );
    expect(
      (await post(c, '/api/social', { action: 'accept', id: 'forged-request' })).status(),
    ).toBe(404);
    await a.goto('/online/midnight-outlaws?party=1');
    await a.getByRole('button', { name: 'Быстрый матч', exact: true }).click();
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-player-count', '1');
    const partyRoom = await a.getByTestId('online-player').getAttribute('data-room');
    await b.goto('/online/midnight-outlaws?party=1');
    await b.getByRole('button', { name: 'Ваша группа Присоединиться', exact: true }).click();
    await expect(b.getByTestId('online-player')).toHaveAttribute('data-room', partyRoom!);
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-player-count', '2');
    await a.getByRole('button', { name: 'Отменить поиск', exact: true }).click();
    await b.getByRole('button', { name: 'Отменить поиск', exact: true }).click();
    await b.goto('/friends');
    await a.goto('/online/midnight-outlaws');
    await activatePad(a, 'select[aria-label="участников"]');
    await activatePad(a, '.controller-select-options button:first-child');
    await activatePad(a, '.room-setup > div .button');
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-player-count', '1');
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-ready', 'true', {
      timeout: 120000,
    });
    const roomId = await a.getByTestId('online-player').getAttribute('data-room');
    expect(
      (await post(c, '/api/multiplayer', { action: 'join', gameId: A.game.id, roomId })).status(),
    ).toBe(403);
    await activatePad(a, '.lobby-friends button');
    await expect(
      b.locator('.invite-card').filter({ hasText: 'Приглашение в гонку' }),
    ).toBeVisible();
    await b
      .locator('.invite-card')
      .filter({ hasText: 'Приглашение в гонку' })
      .getByRole('link', { name: 'Присоединиться', exact: true })
      .click();
    await b.getByRole('button', { name: /Приглашение в гонку/ }).click();
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-player-count', '2');
    await expect(b.getByTestId('online-player')).toHaveAttribute('data-player-count', '2');
    await expect(b.getByTestId('online-player')).toHaveAttribute('data-ready', 'true', {
      timeout: 120000,
    });
    await expect(a.locator('canvas')).toHaveAttribute('data-remote-cars', '1');
    await expect(b.locator('canvas')).toHaveAttribute('data-remote-cars', '1');
    await activatePad(a, '.swatch-violet.car-swatch');
    await b.getByRole('button', { name: 'Ледник', exact: true }).click();
    await activatePad(a, '.lobby-actions button:first-child');
    await b.getByRole('button', { name: 'Я готов', exact: true }).click();
    await activatePad(a, '.lobby-actions button:last-child');
    await installDriver(a);
    await installDriver(b, 'keyboard');
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-phase', 'racing');
    await expect(b.getByTestId('online-player')).toHaveAttribute('data-phase', 'racing');
    const match = await a.getByTestId('online-player').getAttribute('data-match');
    expect(match).toBeTruthy();
    expect(await b.getByTestId('online-player').getAttribute('data-match')).toBe(match);
    await expect
      .poll(async () => Number(await a.getByTestId('online-player').getAttribute('data-speed')))
      .toBeGreaterThan(5);
    await expect
      .poll(async () => Number(await b.getByTestId('online-player').getAttribute('data-speed')))
      .toBeGreaterThan(5);
    const remoteA = await a.getByTestId('online-player').getAttribute('data-remote-x');
    const remoteB = await b.getByTestId('online-player').getAttribute('data-remote-x');
    await expect
      .poll(() => a.getByTestId('online-player').getAttribute('data-remote-x'))
      .not.toBe(remoteA);
    await expect
      .poll(() => b.getByTestId('online-player').getAttribute('data-remote-x'))
      .not.toBe(remoteB);
    await a.evaluate(() => {
      (window as unknown as { nexusDriverPaused: boolean }).nexusDriverPaused = true;
    });
    await expect(a.locator('canvas')).toHaveAttribute('data-throttle', '0');
    await padButton(a, 9, 1);
    await expect(a.locator('.pause-overlay')).toBeVisible();
    await padButton(a, 9, 0);
    await expect(a.locator('html')).toHaveAttribute('data-controller-released', 'true');
    await pressPad(a, 9);
    await expect(a.locator('.pause-overlay')).toHaveCount(0);
    await a.evaluate(() => {
      (window as unknown as { nexusDriverPaused: boolean }).nexusDriverPaused = false;
    });
    // Losing a controller is independent of losing the network connection.
    await a.evaluate(() => {
      const w = window as unknown as {
        nexusDriverPaused: boolean;
        nexusTestPads: { connected: boolean };
      };
      w.nexusDriverPaused = true;
      w.nexusTestPads.connected = false;
    });
    // Wait for the input manager to observe the absent device. Neutral throttle
    // can already be visible from the preceding pause and is not a disconnect acknowledgement.
    await expect(
      a.getByText('Контроллер отключён · DualSense virtual test', { exact: true }),
    ).toBeVisible();
    await expect(a.locator('canvas')).toHaveAttribute('data-throttle', '0');
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-phase', 'racing');
    await expect(a.locator('.pause-overlay')).toHaveCount(0);
    await a.evaluate(() => {
      const w = window as unknown as {
        nexusTestPads: {
          connected: boolean;
          pads: {
            axes: number[];
            buttons: { value: number; pressed: boolean; touched: boolean }[];
          }[];
        };
      };
      w.nexusTestPads.pads[0].axes = [0, 0, 0, 0];
      w.nexusTestPads.pads[0].buttons = w.nexusTestPads.pads[0].buttons.map(() => ({
        value: 0,
        pressed: false,
        touched: false,
      }));
      w.nexusTestPads.connected = true;
    });
    await expect(
      a.getByText('Контроллер подключён · DualSense virtual test', { exact: true }),
    ).toBeVisible();
    await expect(a.locator('html')).toHaveAttribute('data-controller-released', 'true');
    await a.evaluate(() => {
      (window as unknown as { nexusDriverPaused: boolean }).nexusDriverPaused = false;
    });
    await expect
      .poll(async () => Number(await a.locator('canvas').getAttribute('data-throttle')))
      .toBeGreaterThan(0.5);
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-phase', 'results', {
      timeout: 140000,
    });
    await expect(b.getByTestId('online-player')).toHaveAttribute('data-phase', 'results', {
      timeout: 20000,
    });
    await expect(a.getByText('Результаты сохранены', { exact: false })).toBeVisible();
    const saved = await db.multiplayerMatch.findUniqueOrThrow({
      where: { id: match! },
      include: { participants: { include: { result: true } } },
    });
    expect(saved.status).toBe('FINISHED');
    expect(saved.participants).toHaveLength(2);
    expect(
      saved.participants.every((p) => p.result?.serverVerified && p.result.didFinish),
      JSON.stringify(
        saved.participants.map((p) => ({
          device: p.userId === A.id ? 'gamepad' : 'keyboard',
          result: p.result && {
            verified: p.result.serverVerified,
            finished: p.result.didFinish,
            seconds: p.result.timeSeconds,
            place: p.result.place,
          },
        })),
      ),
    ).toBe(true);
    // Capture console UI at native density after the functional software-WebGL race.
    const captureUi = async (path: string) => {
      const capture = await ca.newCDPSession(a);
      await capture.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await a.evaluate(() => window.scrollTo(0, 0));
      await a.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      const { data } = await capture.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const png = Buffer.from(data, 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(900);
      await writeFile(path, png);
      await capture.detach();
    };
    await captureUi('docs/screenshots/multiplayer-results.png');
    await activatePad(a, '.results-actions button.primary');
    await expect(a.getByTestId('online-player')).toHaveAttribute('data-phase', 'lobby');
    await expect(b.getByTestId('online-player')).toHaveAttribute('data-phase', 'lobby');
    await captureUi('docs/screenshots/multiplayer-lobby.png');
    await activatePad(a, '.lobby-panel > .text-button');
    await expect(b.locator('.lobby-roster .lobby-person')).toHaveCount(1);
    await expect(b.getByRole('button', { name: 'Начать заезд', exact: true })).toBeVisible(); // leadership migrates
    await b.getByRole('button', { name: 'Выйти из лобби', exact: true }).click();
    await c.goto('/online/midnight-outlaws');
    await expect(c.getByText(/Сетевые гонки пока доступны на компьютере/)).toBeVisible();
    await expect(c.getByRole('button', { name: 'Быстрый матч', exact: true })).toBeDisabled();
    expect(await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await b.goto('/friends');
    await b.getByLabel('Скрывать присутствие').check();
    await expect
      .poll(async () => {
        social = await (await a.request.get('/api/social')).json();
        return social.network.friends[B.id].status;
      })
      .toBe('offline');
    await a.goto('/friends');
    await a.screenshot({ path: 'docs/screenshots/friends.png' });
    await a
      .locator('.friend-card')
      .getByRole('button', { name: 'Заблокировать', exact: true })
      .click();
    await expect(a.locator('.friend-card')).toHaveCount(0);
    expect(
      (await post(b, '/api/social', { action: 'request', username: A.username })).status(),
    ).toBe(403);
    expect((await post(b, '/api/social', { action: 'partyInvite', userId: A.id })).status()).toBe(
      403,
    );
    await c.goto('/friends');
    expect(await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await c.screenshot({ path: 'docs/screenshots/friends-mobile.png' });
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
});

test('friend requests, removal, blocking, privacy and expired invitations enforce ownership', async ({
  browser,
}) => {
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  try {
    const A = await register(a, 'x'),
      B = await register(b, 'y');
    expect((await post(a, '/api/social', { action: 'request', username: B.username })).ok()).toBe(
      true,
    );
    let data = await (await b.request.get('/api/social')).json();
    const first = data.incoming[0].id;
    expect((await post(a, '/api/social', { action: 'accept', id: first })).status()).toBe(404);
    expect((await post(b, '/api/social', { action: 'decline', id: first })).ok()).toBe(true);
    expect((await post(a, '/api/social', { action: 'request', username: B.username })).ok()).toBe(
      true,
    );
    data = await (await b.request.get('/api/social')).json();
    expect((await post(b, '/api/social', { action: 'accept', id: data.incoming[0].id })).ok()).toBe(
      true,
    );
    expect((await post(a, '/api/social', { action: 'remove', userId: B.id })).ok()).toBe(true);
    expect((await (await a.request.get('/api/social')).json()).friends).toHaveLength(0);
    expect((await post(a, '/api/social', { action: 'block', userId: B.id })).ok()).toBe(true);
    expect(
      (await post(b, '/api/social', { action: 'request', username: A.username })).status(),
    ).toBe(403);
    expect((await (await a.request.get(`/api/social?q=${B.username}`)).json()).users).toHaveLength(
      0,
    );
    expect((await post(a, '/api/social', { action: 'unblock', userId: B.id })).ok()).toBe(true);
    expect((await post(b, '/api/social', { action: 'request', username: A.username })).ok()).toBe(
      true,
    );
    data = await (await a.request.get('/api/social')).json();
    expect((await post(a, '/api/social', { action: 'accept', id: data.incoming[0].id })).ok()).toBe(
      true,
    );
    expect((await post(a, '/api/social', { action: 'partyCreate' })).ok()).toBe(true);
    expect((await post(a, '/api/social', { action: 'partyInvite', userId: B.id })).ok()).toBe(true);
    data = await (await b.request.get('/api/social')).json();
    const invite = data.invites.find((i: { kind: string }) => i.kind === 'PARTY');
    await db.gameInvite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await post(b, '/api/social', { action: 'partyAccept', id: invite.id })).status()).toBe(
      404,
    );
    expect((await a.request.get('/api/admin/multiplayer')).status()).toBe(403);
    expect(
      (
        await post(b, '/api/multiplayer', { action: 'create', gameId: A.game.id, userId: A.id })
      ).status(),
    ).toBe(400);
    expect(
      (
        await post(b, '/api/social', {
          action: 'privacy',
          hideActivity: true,
          friendsOnlyInvites: true,
          showGamePresence: false,
        })
      ).ok(),
    ).toBe(true);
    data = await (await a.request.get('/api/social')).json();
    expect(data.network.friends[B.id]).toEqual({ status: 'offline' });
  } finally {
    await ca.close();
    await cb.close();
  }
});
