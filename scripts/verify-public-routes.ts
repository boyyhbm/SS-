// Reuses only the two account identities in a private, owner-created release
// ledger. No host credential, database access, pose injection or result override.
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { installDriver } from '../tests/helpers/race-driver.ts';
const ledger = path.resolve(process.argv[2] ?? ''),
  origin = process.env.NEXUS_PUBLIC_URL ?? '';
assert(ledger.startsWith('/tmp/nexus-production-'));
assert(/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin));
const state = JSON.parse(await readFile(ledger, 'utf8'));
assert.equal(state.origin, origin);
assert(/^release_[a-f0-9]{8}$/.test(state.prefix));
assert.equal(state.accounts.length, 2);
for (const [i, a] of state.accounts.entries()) {
  assert.equal(a.username, state.prefix + (i ? '_b' : '_a'));
  assert.equal(a.email, a.username + '@example.test');
  assert(/^[a-z0-9]{16,64}$/.test(a.id));
}
const routeIds = process.env.NEXUS_VERIFY_ROUTE
  ? [process.env.NEXUS_VERIFY_ROUTE]
  : ['downtown-circuit', 'midnight-sprint', 'industrial-run', 'legacy-circuit'];
assert(
  routeIds.every((id) =>
    ['downtown-circuit', 'midnight-sprint', 'industrial-run', 'legacy-circuit'].includes(id),
  ),
);
const out = process.env.NEXUS_VERIFY_OUTPUT ?? 'docs/graphics-next/public-routes.json';
await mkdir(path.dirname(out), { recursive: true });
const managed = new URL(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? '');
const proxy = {
  server: managed.origin,
  username: managed.username || undefined,
  password: managed.password || undefined,
};
const browsers = await Promise.all(
  [0, 1].map(() =>
    chromium.launch({
      executablePath: '/usr/bin/chromium',
      proxy,
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
  browsers.map((b) =>
    b.newContext({
      proxy,
      viewport: { width: 960, height: 650 },
      deviceScaleFactor: 0.15,
      reducedMotion: 'reduce',
    }),
  ),
);
for (const c of contexts)
  await c.addInitScript(() =>
    localStorage.setItem(
      'nexus-render-quality',
      JSON.stringify({ state: { quality: 'low' }, version: 0 }),
    ),
  );
const pages = await Promise.all(contexts.map((c) => c.newPage()));
for (const p of pages) p.setDefaultTimeout(180000);
const report: {
  date: string;
  scope: string;
  passed: boolean;
  routes: unknown[];
  stage: string;
  diagnostics?: unknown;
  errorType?: string;
} = {
  date: new Date().toISOString(),
  scope:
    'Two real independent authenticated HTTPS/WSS browser clients, Low/DPR .15 functional verification; NOT a GPU or physical controller certification',
  passed: false,
  routes: [],
  stage: 'login',
};
const json = async (p: Page, url: string) => {
  const r = await p.request.get(origin + url);
  assert(r.ok());
  return r.json();
};
const post = async (p: Page, url: string, data: unknown) => {
  const r = await p.request.post(origin + url, { headers: { Origin: origin }, data });
  assert(r.ok());
  return r.json();
};
try {
  for (const [i, p] of pages.entries()) {
    await p.goto(origin + '/login');
    await p.locator('[name="email"]').fill(state.accounts[i].email);
    await p.locator('[name="password"]').fill(state.accounts[i].password);
    await p.locator('.auth-submit').click();
    await p.waitForURL(origin + '/');
    assert.equal((await json(p, '/api/console')).user.id, state.accounts[i].id);
  }
  const socketOrigins = [new Set<string>(), new Set<string>()];
  pages.forEach((p, i) => p.on('websocket', (s) => socketOrigins[i].add(new URL(s.url()).origin)));
  for (const routeId of routeIds) {
    report.stage = routeId + ': lobby';
    const [a, b] = pages;
    await a.goto(origin + '/online/midnight-outlaws');
    await a.getByLabel('Трасса', { exact: true }).selectOption(routeId);
    await a.getByLabel('участников', { exact: true }).selectOption('2');
    await a.locator('.room-setup > div .button').click();
    await a.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-testid="online-player"]')?.dataset.ready ===
        'true',
    );
    const roomId = await a.getByTestId('online-player').getAttribute('data-room');
    await post(a, '/api/social', { action: 'gameInvite', userId: state.accounts[1].id, roomId });
    await b.goto(origin + '/online/midnight-outlaws?room=' + roomId);
    await b.getByRole('button', { name: /Приглашение в гонку/ }).click();
    await b.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-testid="online-player"]')?.dataset.ready ===
        'true',
    );
    for (const p of pages) {
      assert.equal(await p.getByTestId('online-player').getAttribute('data-room'), roomId);
      assert.equal(await p.getByTestId('online-player').getAttribute('data-route'), routeId);
      await p.getByRole('button', { name: 'Я готов', exact: true }).click();
    }
    report.stage = routeId + ': ready';
    await a.waitForFunction(() => document.querySelectorAll('.lobby-person.is-ready').length === 2);
    await a.getByRole('button', { name: 'Начать заезд', exact: true }).click();
    await installDriver(a, 'gamepad', 'online', 18);
    await installDriver(b, 'keyboard', 'online', 18);
    report.stage = routeId + ': race';
    for (const p of pages)
      await p.waitForFunction(
        () =>
          document.querySelector<HTMLElement>('[data-testid="online-player"]')?.dataset.phase ===
          'racing',
      );
    const matchId = await a.getByTestId('online-player').getAttribute('data-match');
    assert.equal(await b.getByTestId('online-player').getAttribute('data-match'), matchId);
    for (const p of pages) {
      await p.waitForFunction(() => document.querySelector('canvas')?.dataset.remoteCars === '1');
      const x = await p.getByTestId('online-player').getAttribute('data-remote-x');
      await p.waitForFunction(
        (x) =>
          document.querySelector<HTMLElement>('[data-testid="online-player"]')?.dataset.remoteX !==
          x,
        x,
      );
    }
    report.stage = routeId + ': results';
    for (const p of pages) {
      await p.waitForFunction(
        () =>
          document.querySelector<HTMLElement>('[data-testid="online-player"]')?.dataset.phase ===
          'results',
        null,
        { timeout: 240000 },
      );
      await p.getByText('Результаты сохранены', { exact: false }).waitFor();
    }
    const rows = await Promise.all(pages.map((p) => p.locator('.result-row').allTextContents()));
    assert.deepEqual(rows[0], rows[1]);
    const records = [];
    for (const p of pages) {
      const social = await json(p, '/api/social'),
        r = social.history.find((x: { match: { id: string } }) => x.match.id === matchId);
      assert(r?.result?.serverVerified);
      assert(r.result.didFinish);
      assert(r.result.timeSeconds > 8);
      records.push({ place: r.result.place, seconds: r.result.timeSeconds, serverVerified: true });
    }
    assert(socketOrigins.every((s) => s.size > 0 && [...s].every((x) => x.startsWith('wss://'))));
    report.routes.push({ routeId, matchId, records, wss: [...socketOrigins[0]] });
    await a.getByRole('button', { name: 'Ещё один заезд', exact: true }).click();
    for (const p of pages)
      await p.waitForFunction(
        () =>
          document.querySelector<HTMLElement>('[data-testid="online-player"]')?.dataset.phase ===
          'lobby',
      );
    for (const p of pages)
      await p.getByRole('button', { name: 'Выйти из лобби', exact: true }).click();
    await writeFile(out, JSON.stringify(report, null, 2) + '\n');
    console.log('Verified public route', routeId);
  }
  report.passed = true;
  report.stage = 'complete';
} catch (e) {
  report.errorType = e instanceof Error ? e.name : 'Error';
  report.diagnostics = await Promise.all(
    pages.map((p) =>
      p
        .evaluate(() => {
          const r = document.querySelector<HTMLElement>('[data-testid="online-player"]');
          return {
            phase: r?.dataset.phase,
            disconnectCode: r?.dataset.disconnectCode,
            renderReady: r?.dataset.ready,
            players: document.querySelectorAll('.lobby-person').length,
            readyPlayers: document.querySelectorAll('.lobby-person.is-ready').length,
            startDisabled: document.querySelector<HTMLButtonElement>(
              '.lobby-actions .button.primary:last-of-type',
            )?.disabled,
          };
        })
        .catch(() => ({ pageUnavailable: true })),
    ),
  );
  process.exitCode = 1;
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({ passed: report.passed, stage: report.stage, routes: report.routes.length }),
  );
}
