import { test, expect, type Page, chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { cityRoutes } from '../../src/games/road-network';
import { installDriver } from '../helpers/race-driver';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ids: string[] = [];
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const post = (p: Page, url: string, data: unknown) =>
  p.request.post(origin + url, { headers: { Origin: origin }, data });
test.afterAll(async () => {
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'routeweb_' } } });
  await db.$disconnect();
});
const cases = [
  ...cityRoutes.map((route) => ({ route, contacts: false })),
  { route: cityRoutes[0], contacts: true },
];
for (const { route, contacts } of cases)
  test(`two real browser clients finish ${route.id}${contacts ? ' with vehicle contacts' : ''} with identical authoritative results`, async () => {
    test.setTimeout(360000);
    const browsers = await Promise.all(
      [0, 1].map(() =>
        chromium.launch({
          executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
          args: [
            '--no-sandbox',
            '--enable-unsafe-swiftshader',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
          ],
        }),
      ),
    );
    const contexts = await Promise.all(
      browsers.map((browser) =>
        browser.newContext({
          baseURL: origin,
          viewport: { width: 960, height: 650 },
          deviceScaleFactor: Number(process.env.E2E_SOFTWARE_DPR ?? 1),
          reducedMotion: 'reduce',
          ...(process.env.NEXUS_CAPTURE_ONLINE === '1'
            ? {
                recordVideo: {
                  dir: 'docs/gameplay-update/raw-video',
                  size: { width: 1280, height: 720 },
                },
              }
            : {}),
        }),
      ),
    );
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const events: { client: number; type: string; at: number }[] = [];
    for (const [client, p] of pages.entries()) {
      await p.addInitScript(() => {
        (window as unknown as { raceProbe: unknown }).raceProbe = null;
        window.addEventListener(
          'nexus-render-stats',
          (e) =>
            ((window as unknown as { raceProbe: unknown }).raceProbe = (e as CustomEvent).detail),
        );
      });
      p.on('console', (m) => {
        if (m.text().includes('Colyseus reconnection'))
          events.push({
            client,
            type: m.text().includes('successful')
              ? 'reconnected'
              : m.text().includes('failed')
                ? 'reconnect-failed'
                : 'reconnect-attempt',
            at: Date.now(),
          });
      });
      p.on('websocket', (socket) =>
        socket.on('close', () => events.push({ client, type: 'socket-closed', at: Date.now() })),
      );
    }
    let probing = false;
    const probe = setInterval(async () => {
      if (probing) return;
      probing = true;
      try {
        const clients = await Promise.all(
          pages.map((p) =>
            p.evaluate(() => {
              const root = document.querySelector<HTMLElement>('[data-testid="online-player"]'),
                c = document.querySelector<HTMLCanvasElement>('canvas');
              return {
                phase: root?.dataset.phase,
                closeCode: root?.dataset.disconnectCode,
                speed: root?.dataset.speed,
                checkpoint: document.querySelector('[data-testid="checkpoint"]')?.textContent,
                input: c ? { gas: c.dataset.throttle, steer: c.dataset.steer } : null,
                stats: (window as unknown as { raceProbe: unknown }).raceProbe,
              };
            }),
          ),
        );
        await writeFile(
          '/tmp/nexus-online-probe.json',
          JSON.stringify({ date: new Date().toISOString(), events, clients }),
          { mode: 0o600 },
        );
      } catch {
      } finally {
        probing = false;
      }
    }, 10000);
    const users: { id: string; username: string }[] = [];
    let gameId = '';
    try {
      for (const p of pages) {
        const name = 'routeweb_' + randomBytes(5).toString('hex'),
          password = randomBytes(20).toString('hex');
        await p.goto('/register');
        for (const [k, v] of Object.entries({
          username: name,
          email: name + '@example.test',
          password,
          confirmPassword: password,
        }))
          await p.locator(`[name="${k}"]`).fill(v);
        await p.locator('.auth-submit').click();
        await expect(p).toHaveURL(origin + '/');
        const data = await (await p.request.get(origin + '/api/console')).json();
        ids.push(data.user.id);
        users.push(data.user);
        gameId = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws').id;
        expect((await post(p, '/api/library', { action: 'add', gameId })).ok()).toBe(true);
      }
      expect(
        (
          await post(pages[0], '/api/social', { action: 'request', username: users[1].username })
        ).ok(),
      ).toBe(true);
      const social = await (await pages[1].request.get(origin + '/api/social')).json();
      expect(
        (await post(pages[1], '/api/social', { action: 'accept', id: social.incoming[0].id })).ok(),
      ).toBe(true);
      const [a, b] = pages;
      expect((await post(a, '/api/racing-settings', { racingLine: 'full' })).ok()).toBe(true);
      expect((await (await b.request.get(origin + '/api/racing-settings')).json()).racingLine).toBe(
        'corners',
      );
      await a.goto('/online/midnight-outlaws');
      await a.getByLabel('Трасса', { exact: true }).selectOption(route.id);
      await a.getByLabel('участников', { exact: true }).selectOption('2');
      await a.locator('.room-setup > div .button').click();
      await expect(a.getByTestId('online-player')).toHaveAttribute('data-ready', 'true', {
        timeout: 120000,
      });
      const roomId = await a.getByTestId('online-player').getAttribute('data-room');
      expect(
        (await post(a, '/api/social', { action: 'gameInvite', userId: users[1].id, roomId })).ok(),
      ).toBe(true);
      await b.goto('/online/midnight-outlaws?room=' + roomId);
      await b.getByRole('button', { name: /Приглашение в гонку/ }).click();
      await expect(b.getByTestId('online-player')).toHaveAttribute('data-ready', 'true', {
        timeout: 120000,
      });
      if (contacts) {
        await a.getByLabel('Столкновения автомобилей', { exact: true }).click();
        for (const p of pages)
          await expect(p.getByTestId('online-player')).toHaveAttribute('data-car-contacts', 'true');
        await expect(a.getByLabel('Столкновения автомобилей', { exact: true })).toBeChecked();
      }
      for (const p of pages) {
        await expect(p.getByTestId('online-player')).toHaveAttribute('data-route', route.id);
        await expect(p.locator('canvas')).toHaveAttribute('data-route', route.id);
        await expect(p.locator('canvas')).toHaveAttribute(
          'data-racing-line',
          p === a ? 'full' : 'corners',
        );
        await p.getByRole('button', { name: 'Я готов', exact: true }).click();
      }
      await a.getByRole('button', { name: 'Начать заезд', exact: true }).click();
      await installDriver(a, 'gamepad', 'online', 18);
      await installDriver(b, 'keyboard', 'online', 18);
      for (const p of pages)
        await expect(p.getByTestId('online-player')).toHaveAttribute('data-phase', 'racing');
      const matchId = await a.getByTestId('online-player').getAttribute('data-match');
      expect(await b.getByTestId('online-player').getAttribute('data-match')).toBe(matchId);
      for (const p of pages) {
        await expect(p.locator('canvas')).toHaveAttribute('data-remote-cars', '1');
        await expect(p.getByTestId('online-player')).toHaveAttribute('data-phase', 'results', {
          timeout: 200000,
        });
        await expect(p.getByText('Результаты сохранены', { exact: false })).toBeVisible();
      }
      expect(await a.locator('.result-row').allTextContents()).toEqual(
        await b.locator('.result-row').allTextContents(),
      );
      const m = await db.multiplayerMatch.findUniqueOrThrow({
        where: { id: matchId! },
        include: { participants: { include: { result: true } } },
      });
      expect(m.routeId).toBe(route.id);
      expect(m.carContacts).toBe(contacts);
      if (contacts)
        for (const p of pages)
          expect(
            Number(await p.getByTestId('online-player').getAttribute('data-contact-events')),
          ).toBeGreaterThan(0);
      expect(m.routeVersion).toBe(1);
      expect(m.participants.every((p) => p.result?.didFinish && p.result.serverVerified)).toBe(
        true,
      );
      await a.locator('.results-actions button.primary').click();
      for (const p of pages)
        await expect(p.getByTestId('online-player')).toHaveAttribute('data-phase', 'lobby');
    } finally {
      clearInterval(probe);
      await Promise.all(contexts.map((c) => c.close()));
      await Promise.all(browsers.map((b) => b.close()));
    }
  });
