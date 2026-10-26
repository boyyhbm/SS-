import assert from 'node:assert/strict';
import { chromium, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installDriver } from '../tests/helpers/race-driver.ts';
import { defaultConfig } from '../src/input/profiles.ts';

// No DATABASE_URL, hosting credentials or production administrator account is needed.
// The default path accepts only genuine public HTTPS/WSS with normal TLS validation.
const configured = process.env.NEXUS_PUBLIC_URL;
if (!configured) throw Error('Set NEXUS_PUBLIC_URL to the actual deployed HTTPS origin');
const url = new URL(configured);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const rehearsal = process.env.NEXUS_LOCAL_TLS_REHEARSAL === '1' && local;
if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  url.pathname !== '/' ||
  url.search ||
  url.hash ||
  (local && !rehearsal) ||
  url.hostname.endsWith('.internal') ||
  (!local && !url.hostname.includes('.'))
)
  throw Error('A public HTTPS origin is required');
const origin = url.origin;
const mode = process.argv[2] ?? 'before';
if (!['before', 'after-restart'].includes(mode)) throw Error('Use before or after-restart');
const folder =
  mode === 'before'
    ? await mkdtemp(path.join(os.tmpdir(), 'nexus-production-'))
    : path.dirname(path.resolve(process.argv[3] ?? ''));
if (mode === 'after-restart' && !process.argv[3])
  throw Error('Provide the private state file from the before run');
if (!path.relative(process.cwd(), folder).startsWith('..'))
  throw Error('Private test state must stay outside Git');
await mkdir(folder, { recursive: true, mode: 0o700 });
type Account = { username: string; email: string; password: string; id?: string };
type ConsoleData = {
  user: { id: string } | null;
  games: { id: string; slug: string }[];
  library: { gameId: string; isFavorite: boolean; lastPlayedAt: string | null }[];
  saves: { gameId: string; saveData: unknown }[];
};
type SocialData = {
  incoming: { id: string }[];
  friends: { id: string }[];
  history: {
    match: { id: string; status: string };
    result: {
      serverVerified: boolean;
      didFinish: boolean;
      timeSeconds: number;
      place: number;
    } | null;
  }[];
};
type Controllers = {
  activeId: string | null;
  profiles: { id: string; name: string; config: unknown }[];
};
type Saved = {
  origin: string;
  rehearsal: boolean;
  prefix: string;
  accounts: Account[];
  matchId?: string;
  snapshots?: unknown[];
  boot?: { web: string; game: string; gameOrigin: string };
  restartVerified?: boolean;
};
const stateFile = path.join(folder, 'state.json');
const state: Saved =
  mode === 'before'
    ? { origin, rehearsal, prefix: `release_${randomBytes(4).toString('hex')}`, accounts: [] }
    : JSON.parse(await readFile(path.resolve(process.argv[3]), 'utf8'));
assert.equal(state.origin, origin);
assert.equal(state.rehearsal, rehearsal);
const saveState = () => writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
const report: {
  scope: string;
  publicDeploymentVerified: boolean;
  passed: boolean;
  checks: string[];
  failedStep?: string;
  controllerHardware: string;
} = {
  scope: rehearsal ? 'LOCAL TLS rehearsal' : 'PUBLIC HTTPS/WSS',
  publicDeploymentVerified: false,
  passed: false,
  checks: [],
  controllerHardware: 'Physical controllers not tested; virtual Gamepad API only',
};
let step = 'HTTPS health';
// The cloud runner may require its managed HTTP proxy for Node-side API calls.
// Keep this opt-in so loopback TLS rehearsals retain their direct connection.
const proxy = (() => {
  if (process.env.NEXUS_TEST_USE_PROXY !== '1') return undefined;
  let configured;
  try {
    configured = new URL(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? '');
  } catch {
    throw Error('Managed test proxy is not configured');
  }
  if (!['http:', 'https:'].includes(configured.protocol))
    throw Error('Managed test proxy must use HTTP or HTTPS');
  return {
    server: configured.origin,
    username: configured.username ? decodeURIComponent(configured.username) : undefined,
    password: configured.password ? decodeURIComponent(configured.password) : undefined,
  };
})();
const launchOptions = {
  proxy,
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(rehearsal && process.env.NEXUS_TEST_TLS_SPKI
      ? [`--ignore-certificate-errors-spki-list=${process.env.NEXUS_TEST_TLS_SPKI}`]
      : []),
  ],
};
// Independent browser processes model two computers and avoid one window
// taking keyboard focus from the other when a gamepad becomes active.
const browsers = await Promise.all([0, 1].map(() => chromium.launch(launchOptions)));
const contexts = await Promise.all(
  browsers.map((browser) =>
    browser.newContext({
      proxy,
      viewport: { width: 960, height: 650 },
      deviceScaleFactor: Number(process.env.NEXUS_PRODUCTION_TEST_DPR ?? 0.15),
      reducedMotion: 'reduce',
    }),
  ),
);
const pages = await Promise.all(contexts.map((context) => context.newPage()));
for (const page of pages) page.setDefaultTimeout(180000);
async function json<T>(page: Page, route: string): Promise<T> {
  const res = await page.request.get(origin + route);
  assert.equal(res.ok(), true);
  return res.json();
}
async function post(page: Page, route: string, data: unknown) {
  const res = await page.request.post(origin + route, { headers: { Origin: origin }, data });
  assert.equal(res.ok(), true);
  return res.json();
}
async function login(page: Page, account: Account) {
  await page.goto(origin + '/login');
  await page.locator('[name="email"]').fill(account.email);
  await page.locator('[name="password"]').fill(account.password);
  await page.locator('.auth-submit').click();
  await page.waitForURL(origin + '/');
}
async function snapshot(page: Page) {
  const console = await json<ConsoleData>(page, '/api/console');
  const controllers = await json<Controllers>(page, '/api/controllers');
  const social = await json<SocialData>(page, '/api/social');
  const result = social.history.find((p) => p.match.id === state.matchId);
  assert.equal(result?.result?.serverVerified, true);
  assert.equal(result?.result?.didFinish, true);
  return {
    userId: console.user!.id,
    library: console.library.map(({ gameId, isFavorite, lastPlayedAt }) => ({
      gameId,
      isFavorite,
      lastPlayedAt,
    })),
    saves: console.saves.map(({ gameId, saveData }) => ({ gameId, saveData })),
    controllers,
    friends: social.friends.map((p) => p.id).sort(),
    result: result
      ? {
          match: { id: result.match.id, status: result.match.status },
          result: result.result
            ? {
                serverVerified: result.result.serverVerified,
                didFinish: result.result.didFinish,
                timeSeconds: result.result.timeSeconds,
                place: result.result.place,
              }
            : null,
        }
      : null,
  };
}
try {
  const response = await pages[0].goto(origin + '/api/health');
  assert.equal(response?.status(), 200);
  if (mode === 'after-restart') {
    step = 'Persistence after host-triggered server restart';
    assert.ok(state.boot);
    const webBoot = await json<{ instanceId: string }>(pages[0], '/api/health');
    const gameResponse = await pages[0].request.get(state.boot.gameOrigin + '/health');
    assert.equal(gameResponse.ok(), true);
    const gameBoot = await gameResponse.json();
    assert.notEqual(webBoot.instanceId, state.boot.web);
    assert.notEqual(gameBoot.instanceId, state.boot.game);
    for (let i = 0; i < 2; i++) await login(pages[i], state.accounts[i]);
    const current = await Promise.all(pages.map(snapshot));
    assert.deepEqual(current, state.snapshots);
    state.restartVerified = true;
    await saveState();
    report.checks.push(
      'Re-login after an externally triggered restart preserves accounts, library, favorites, controller profile, saves, friends and server-verified results',
    );
  } else {
    step = 'Real registration and secure authentication';
    const identities: string[] = [];
    for (let i = 0; i < 2; i++) {
      const page = pages[i];
      const username = state.prefix + (i ? '_b' : '_a');
      const account: Account = {
        username,
        email: `${username}@example.test`,
        password: randomBytes(24).toString('hex'),
      };
      state.accounts.push(account);
      await saveState();
      await page.goto(origin + '/register');
      for (const [field, value] of Object.entries({
        username,
        email: account.email,
        password: account.password,
        confirmPassword: account.password,
      }))
        await page.locator(`[name="${field}"]`).fill(value);
      await page.locator('.auth-submit').click();
      await page.waitForURL(origin + '/');
      const data = await json<ConsoleData>(page, '/api/console');
      assert.ok(data.user);
      account.id = data.user.id;
      await saveState();
      assert.equal(data.library.length, 0);
      identities.push(data.user.id);
      const cookies = await contexts[i].cookies(origin);
      const cookie = cookies.find((c) => c.name.includes('next-auth.session-token'));
      assert.equal(cookie?.secure, true);
      assert.equal(cookie?.httpOnly, true);
      await page.goto(origin + '/discover');
      await page.locator('.hero-actions .button.primary').click();
      await page.waitForFunction(
        async () => (await (await fetch('/api/console')).json()).library.length === 1,
      );
      await page.locator('.hero-actions .favorite-button').click();
      await page.waitForFunction(
        async () => (await (await fetch('/api/console')).json()).library[0].isFavorite,
      );
    }
    report.checks.push(
      'Two real independent registrations, empty initial libraries, secure HTTP-only cookies, Discover add and favorite',
    );
    step = 'Logout and returning-user persistence';
    const csrf = await json<{ csrfToken: string }>(pages[0], '/api/auth/csrf');
    await pages[0].request.post(origin + '/api/auth/signout', {
      form: { csrfToken: csrf.csrfToken, callbackUrl: origin, json: 'true' },
    });
    assert.equal((await json<ConsoleData>(pages[0], '/api/console')).user, null);
    await login(pages[0], state.accounts[0]);
    assert.equal((await json<ConsoleData>(pages[0], '/api/console')).library[0].isFavorite, true);
    await post(pages[0], '/api/controllers', {
      action: 'save',
      name: 'Production verification',
      deviceKey: null,
      config: defaultConfig(),
    });
    report.checks.push(
      'Logout/re-login retains library and favorite; account-owned controller profile saved',
    );
    step = 'Actual single-player runtime and real lap save';
    await pages[0].goto(origin + '/play/midnight-outlaws');
    assert.equal(
      await pages[0].evaluate(() => isSecureContext && typeof navigator.getGamepads === 'function'),
      true,
    );
    await pages[0].getByRole('button', { name: 'На старт', exact: true }).click();
    await installDriver(pages[0], 'gamepad', 'single', 18);
    await pages[0].waitForFunction(
      () => document.querySelector('[data-testid="race-player"]')?.getAttribute('data-lap') === '2',
    );
    await pages[0].waitForFunction(
      async () => (await (await fetch('/api/console')).json()).saves.length > 0,
    );
    await pages[0].keyboard.press('Escape');
    await pages[0].getByRole('button', { name: 'Выйти в консоль', exact: true }).last().click();
    report.checks.push(
      'Real GLB runtime, virtual analog input, completed lap and durable save; physical controller unverified',
    );
    step = 'Friend invitation and private multiplayer lobby';
    await post(pages[0], '/api/social', {
      action: 'request',
      username: state.accounts[1].username,
    });
    const incoming = await json<SocialData>(pages[1], '/api/social');
    await post(pages[1], '/api/social', { action: 'accept', id: incoming.incoming[0].id });
    const sockets: string[][] = [[], []];
    pages.forEach((page, i) =>
      page.on('websocket', (socket) => sockets[i].push(new URL(socket.url()).origin)),
    );
    await pages[0].goto(origin + '/online/midnight-outlaws');
    if (process.env.NEXUS_PRODUCTION_ROUTE) {
      const route = process.env.NEXUS_PRODUCTION_ROUTE;
      if (
        !['legacy-circuit', 'downtown-circuit', 'midnight-sprint', 'industrial-run'].includes(route)
      )
        throw Error('Unknown verification route');
      await pages[0].getByLabel('Трасса', { exact: true }).selectOption(route);
    }
    await pages[0].locator('select[aria-label="участников"]').selectOption('2');
    await pages[0].locator('.room-setup > div .button').click();
    await pages[0].waitForFunction(
      () =>
        document.querySelector('[data-testid="online-player"]')?.getAttribute('data-ready') ===
        'true',
    );
    const roomId = await pages[0].getByTestId('online-player').getAttribute('data-room');
    await post(pages[0], '/api/social', { action: 'gameInvite', userId: identities[1], roomId });
    await pages[1].goto(origin + '/friends');
    await pages[1]
      .locator('.invite-card')
      .filter({ hasText: 'Приглашение в гонку' })
      .getByRole('link', { name: 'Присоединиться', exact: true })
      .click();
    await pages[1].getByRole('button', { name: /Приглашение в гонку/ }).click();
    await pages[1].waitForFunction(
      () =>
        document.querySelector('[data-testid="online-player"]')?.getAttribute('data-ready') ===
        'true',
    );
    assert.equal(await pages[1].getByTestId('online-player').getAttribute('data-room'), roomId);
    step = 'Synchronized WSS race, movement and server results';
    await pages[0].getByRole('button', { name: 'Я готов', exact: true }).click();
    await pages[1].getByRole('button', { name: 'Я готов', exact: true }).click();
    await pages[0].getByRole('button', { name: 'Начать заезд', exact: true }).click();
    await installDriver(pages[0], 'gamepad', 'online', 18);
    await installDriver(pages[1], 'keyboard', 'online', 18);
    for (const page of pages)
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="online-player"]')?.getAttribute('data-phase') ===
          'racing',
      );
    state.matchId = (await pages[0].getByTestId('online-player').getAttribute('data-match'))!;
    assert.equal(
      await pages[1].getByTestId('online-player').getAttribute('data-match'),
      state.matchId,
    );
    for (const page of pages) {
      const previous = await page.getByTestId('online-player').getAttribute('data-remote-x');
      await page.waitForFunction(
        (x) =>
          document.querySelector('[data-testid="online-player"]')?.getAttribute('data-remote-x') !==
          x,
        previous,
      );
    }
    for (const page of pages)
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="online-player"]')?.getAttribute('data-phase') ===
          'results',
      );
    await pages[0].getByText('Результаты сохранены', { exact: false }).waitFor();
    for (const origins of sockets) {
      assert.ok(origins.length);
      assert.ok(origins.every((s) => new URL(s).protocol === 'wss:'));
    }
    assert.equal(sockets[0][0], sockets[1][0]);
    const gameOrigin = sockets[0][0].replace(/^wss:/, 'https:');
    const gameHealth = await pages[0].request.get(gameOrigin + '/health');
    assert.equal(gameHealth.ok(), true);
    state.boot = {
      web: (await json<{ instanceId: string }>(pages[0], '/api/health')).instanceId,
      game: (await gameHealth.json()).instanceId,
      gameOrigin,
    };
    state.snapshots = await Promise.all(pages.map(snapshot));
    await saveState();
    await pages[0].locator('.results-actions button.primary').click();
    for (const page of pages)
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="online-player"]')?.getAttribute('data-phase') ===
          'lobby',
      );
    report.checks.push(
      'Two independent WSS clients, friend invitation, private room, ready/countdown, shared match, remote movement, both server-verified finishes, saved history and rematch lobby',
    );
    report.checks.push(
      'Persistence snapshot stored privately; actual host restart still needs after-restart verification',
    );
  }
  report.passed = true;
  report.publicDeploymentVerified =
    !rehearsal && mode === 'after-restart' && state.restartVerified === true;
} catch (error) {
  report.failedStep = step;
  // Private diagnostics live beside the private credential ledger, never in Git/logs.
  await writeFile(
    path.join(folder, `${mode}-failure-private.txt`),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    { mode: 0o600 },
  );
  // Do not print Playwright errors: form call logs can contain generated passwords.
  console.error(`Production verification failed at: ${step}. Credentials were not logged.`);
  process.exitCode = 1;
} finally {
  await Promise.all(browsers.map((browser) => browser.close()));
  await writeFile(
    path.join(folder, `${mode}-report.json`),
    JSON.stringify({ date: new Date().toISOString(), ...report }, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ...report, privateStateFile: stateFile }));
}
