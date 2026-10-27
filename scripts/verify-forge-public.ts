import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { chromium, request, expect, type APIRequestContext } from '@playwright/test';
import { installForgeBrowserDriver } from '../tests/helpers/forge-browser-driver';
import { defaultConfig } from '../src/input/profiles';
import type { ForgeState } from '../src/games/fold/contracts';

// Runs on a separate verification branch/runner so waiting for hosting cannot
// deadlock the release's checksPass deployment. No hosting key is required.
// Credentials are generated in memory; cookies, request headers and browser
// traces are never committed or uploaded.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF_NAME, 'verification/fold-zero');
const source = process.env.NEXUS_PUBLIC_SOURCE!;
assert(/^[a-f0-9]{40}$/.test(source));
const origin = 'https://nexus-web-ylcv.onrender.com';
const multiplayer = 'https://nexus-multiplayer.onrender.com';
const reportPath = 'docs/fold-zero/remote-validation.json';
const token = process.env.GITHUB_TOKEN!;
assert(token);
const report = {
  date: new Date().toISOString(),
  updatedAt: '',
  sourceCommit: source,
  runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  passed: false,
  stage: 'starting',
  scope:
    'Actual public HTTPS/WSS. Two independent authenticated Chromium processes, normal keyboard/Pointer Lock input. Reduced software-GPU backing resolution. Not a physical-device or final-art acceptance.',
  ci: null as unknown,
  services: null as unknown,
  persistence: null as unknown,
  checks: [] as string[],
  websocketOrigins: [] as string[],
  records: [] as unknown[],
  shots: 0,
  hits: 0,
  score: null as number[] | null,
  errors: [] as string[],
  failure: null as { name: string; stage: string; sourceLine?: string } | null,
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function publish(stage: string) {
  report.stage = stage;
  report.updatedAt = new Date().toISOString();
  await fs.mkdir('docs/fold-zero', { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  execFileSync('git', ['config', 'user.name', 'NEXUS verification']);
  execFileSync('git', ['config', 'user.email', 'nexus-verification@users.noreply.github.com']);
  execFileSync('git', ['add', reportPath]);
  execFileSync('git', ['commit', '-m', `[skip ci] Record Fold public verification: ${stage}`], {
    stdio: 'ignore',
  });
  execFileSync('git', ['push', 'origin', 'HEAD:verification/fold-zero'], { stdio: 'ignore' });
  console.log(JSON.stringify({ stage, passed: report.passed, checks: report.checks.length }));
}
async function github(route: string) {
  const response = await fetch(
    'https://api.github.com/repos/' + process.env.GITHUB_REPOSITORY + '/' + route,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.equal(response.status, 200, 'GitHub status request');
  return response.json();
}
async function get(api: APIRequestContext, path: string) {
  const response = await api.get(origin + path);
  assert.equal(response.status(), 200, 'Public read response');
  return response.json();
}
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post(origin + path, { headers: { Origin: origin }, data });
  assert.equal(response.status(), 200, 'Public mutation response');
  return response.json();
}
type Account = { username: string; email: string; password: string; id: string };
const accounts: Account[] = [];
const apiClients: APIRequestContext[] = [];
const browsers: Awaited<ReturnType<typeof chromium.launch>>[] = [];
async function login(api: APIRequestContext, account: Account) {
  const { csrfToken } = await get(api, '/api/auth/csrf');
  await api.post(origin + '/api/auth/callback/credentials', {
    headers: { Origin: origin },
    form: {
      csrfToken,
      email: account.email,
      password: account.password,
      remember: 'true',
      json: 'true',
      callbackUrl: origin,
    },
  });
  const current = await get(api, '/api/console');
  if (account.id) assert.equal(current.user?.id, account.id);
  else account.id = current.user?.id;
  assert(account.id);
  return current;
}
async function canonical(api: APIRequestContext) {
  const data = await get(api, '/api/console');
  const social = await get(api, '/api/social');
  const controls = await get(api, '/api/controllers');
  const garage = await get(api, '/api/garage');
  const audio = await get(api, '/api/game-audio');
  const racing = await get(api, '/api/racing-settings');
  return {
    userId: data.user?.id,
    library: data.library,
    saves: data.saves,
    controls,
    garage,
    audio,
    racing,
    friends: social.friends.map((f: { id: string }) => f.id).sort(),
  };
}
async function health() {
  const responses = await Promise.all(
    [origin + '/api/health', multiplayer + '/health'].map(async (url) => {
      const r = await fetch(url + '?forge=' + Date.now(), {
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });
      if (!r.ok) return null;
      return r.json();
    }),
  );
  return { web: responses[0], multiplayer: responses[1] };
}
let stage = 'baseline';
try {
  const beforeHealth = await health();
  assert(beforeHealth.web?.ok && beforeHealth.multiplayer?.ok);
  const baselinePredatesRelease = !(await (await fetch(origin + '/api/console')).json()).games.some(
    (g: { slug: string }) => g.slug === 'fold-zero',
  );
  const prefix = 'forgepub_' + randomBytes(4).toString('hex');
  for (let i = 0; i < 2; i++) {
    const api = await request.newContext();
    apiClients.push(api);
    const username = prefix + (i ? '_b' : '_a');
    const account = {
      username,
      email: username + '@example.test',
      password: randomBytes(24).toString('hex'),
      id: '',
    };
    accounts.push(account);
    const registered = await api.post(origin + '/api/register', {
      headers: { Origin: origin },
      data: { ...account, confirmPassword: account.password },
    });
    assert.equal(registered.status(), 201, 'Real registration');
    const data = await login(api, account);
    assert.equal(data.library.length, 0);
    const cookie = (await api.storageState()).cookies.find((c) =>
      c.name.includes('next-auth.session-token'),
    );
    assert(cookie?.httpOnly && cookie.secure, 'Secure authentication cookie');
    const race = data.games.find((g: { slug: string }) => g.slug === 'midnight-outlaws');
    assert(race);
    await post(api, '/api/library', { gameId: race.id, action: 'add' });
    await post(api, '/api/library', { gameId: race.id, action: 'favorite' });
    await post(api, '/api/controllers', {
      action: 'save',
      name: 'Public Forge verification',
      deviceKey: null,
      config: defaultConfig(),
    });
  }
  await post(apiClients[0], '/api/social', { action: 'request', username: accounts[1].username });
  const incoming = (await get(apiClients[1], '/api/social')).incoming.find(
    (v: { senderId: string }) => v.senderId === accounts[0].id,
  );
  assert(incoming);
  await post(apiClients[1], '/api/social', { action: 'accept', id: incoming.id });
  const baseline = await Promise.all(apiClients.map(canonical));
  report.checks.push(
    'Two actual public registrations, separate initially empty libraries, secure cookies, racing favorites, saved controller profiles and friendship',
  );
  report.persistence = {
    baselinePredatesRelease,
    beforeCaptured: true,
    comparedAfterRollout: false,
  };
  await publish('baseline-ready');

  stage = 'release checks';
  const waitStarted = Date.now();
  while (true) {
    const result = await github('actions/runs?head_sha=' + source + '&event=push&per_page=30');
    const ci = result.workflow_runs.find((r: { name: string }) => r.name === 'NEXUS checks');
    if (ci?.status === 'completed') {
      const jobs = await github('actions/runs/' + ci.id + '/jobs');
      report.ci = {
        id: ci.id,
        url: ci.html_url,
        status: ci.status,
        conclusion: ci.conclusion,
        jobs: jobs.jobs.map(
          (j: {
            name: string;
            conclusion: string;
            steps: { name: string; conclusion: string }[];
          }) => ({
            name: j.name,
            conclusion: j.conclusion,
            steps: j.steps.map((s) => ({ name: s.name, conclusion: s.conclusion })),
          }),
        ),
      };
      assert.equal(ci.conclusion, 'success', 'The full release checks did not pass');
      break;
    }
    assert(Date.now() - waitStarted < 55 * 60000, 'Release checks wait timeout');
    await pause(20000);
  }
  await publish('release-checks-passed');

  stage = 'public rollout';
  const expected = createHash('sha256')
    .update(await fs.readFile('public/game-assets/forge/manifest.json'))
    .digest('hex');
  const rolloutStarted = Date.now();
  let live: Awaited<ReturnType<typeof health>> | null = null;
  while (true) {
    try {
      const h = await health();
      const r = await fetch(origin + '/game-assets/forge/manifest.json?forge=' + Date.now(), {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      const actual = r.ok
        ? createHash('sha256')
            .update(Buffer.from(await r.arrayBuffer()))
            .digest('hex')
        : '';
      const changed =
        !baselinePredatesRelease ||
        (h.web?.instanceId !== beforeHealth.web.instanceId &&
          h.multiplayer?.instanceId !== beforeHealth.multiplayer.instanceId);
      if (h.web?.ok && h.multiplayer?.ok && expected === actual && changed) {
        live = h;
        break;
      }
    } catch {
      /* Readiness can be unavailable during the real deployment. */
    }
    assert(Date.now() - rolloutStarted < 40 * 60000, 'Public rollout wait timeout');
    await pause(20000);
  }
  report.services = {
    web: { url: origin, status: 'HEALTHY', healthStatus: 200 },
    multiplayer: { url: multiplayer, status: 'HEALTHY', healthStatus: 200 },
    postgres: { status: 'REACHABLE_BY_BOTH_SERVICES' },
    expectedForgeManifestSha256: expected,
    exactHostCommitFromProviderApi: 'UNAVAILABLE: no hosting credentials used by this runner',
  };
  for (let i = 0; i < 2; i++) await login(apiClients[i], accounts[i]);
  assert.deepEqual(await Promise.all(apiClients.map(canonical)), baseline);
  report.persistence = {
    baselinePredatesRelease,
    beforeCaptured: true,
    comparedAfterRollout: true,
    passed: true,
    webInstanceChanged: live!.web.instanceId !== beforeHealth.web.instanceId,
    multiplayerInstanceChanged:
      live!.multiplayer.instanceId !== beforeHealth.multiplayer.instanceId,
    scope:
      'These two new owned fixture accounts only: identity, racing library/favorite, controller profiles, garage/audio/racing settings, saves and friends. No historical-match claim for these initially new accounts.',
  };
  await publish('public-rollout-and-persistence-passed');

  stage = 'duel';
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const browser = await chromium.launch({
      args: [
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
    browsers.push(browser);
    const context = await browser.newContext({
      storageState: await apiClients[i].storageState(),
      viewport: { width: 960, height: 650 },
      deviceScaleFactor: 0.15,
    });
    const page = await context.newPage();
    pages.push(page);
    page.setDefaultTimeout(90000);
    page.on('pageerror', (e) => report.errors.push(e.name));
    page.on('websocket', (socket) => {
      const socketOrigin = new URL(socket.url()).origin;
      if (!report.websocketOrigins.includes(socketOrigin))
        report.websocketOrigins.push(socketOrigin);
    });
    await page.addInitScript('globalThis.__name=fn=>fn;');
    await page.addInitScript(() => {
      const w = window as unknown as { forgeState: unknown; forgeAim: unknown; forgePad: unknown };
      w.forgeState = null;
      w.forgeAim = null;
      w.forgePad = { axes: [0, 0, 0, 0], buttons: Array(17).fill(0) };
      window.addEventListener('nexus-forge-state', (e) => {
        w.forgeState = (e as CustomEvent).detail;
      });
      window.addEventListener('nexus-forge-aim', (e) => {
        w.forgeAim = (e as CustomEvent).detail;
      });
    });
    const data = await get(page.request, '/api/console');
    assert.equal(data.user.id, accounts[i].id);
    const game = data.games.find((g: { slug: string }) => g.slug === 'fold-zero');
    assert.equal(game?.status, 'AVAILABLE');
    await post(page.request, '/api/library', { action: 'add', gameId: game.id });
    await post(page.request, '/api/fold-settings', {
      quality: 'competitive',
      mouseSensitivity: 1,
      aimSensitivity: 1,
      responseCurve: 1.5,
      invertY: false,
      headBob: false,
      master: 0.65,
      weapons: 0.8,
      environment: 0.4,
      effects: 0.7,
    });
    await page.goto(origin + '/play/fold-zero');
    await expect(page.getByTestId('fold-player')).toHaveAttribute('data-loaded', 'true', {
      timeout: 120000,
    });
  }
  const [a, b] = pages;
  await a.getByRole('button', { name: 'Private Duel', exact: true }).click();
  await expect(a.getByTestId('forge-ready')).toBeVisible();
  await a.getByRole('button', { name: 'Пригласить друга', exact: true }).click();
  const sent = a.waitForResponse(
    (r) => r.url().endsWith('/api/social') && r.request().method() === 'POST',
  );
  await a.getByRole('button', { name: accounts[1].username, exact: true }).click();
  assert.equal((await sent).status(), 200);
  const invites = await get(b.request, '/api/social');
  const invite = invites.invites.find(
    (v: { game?: { slug: string } }) => v.game?.slug === 'fold-zero',
  );
  assert(invite);
  await a.getByRole('button', { name: 'Назад', exact: true }).click();
  await b.goto(origin + '/online/fold-zero?room=' + encodeURIComponent(invite.roomId));
  await expect(b.getByTestId('forge-ready')).toBeVisible({ timeout: 120000 });
  for (const p of pages) await p.getByTestId('forge-ready').click();
  await expect(a.getByTestId('forge-start')).toBeEnabled();
  await a.getByTestId('forge-start').click();
  for (const [slot, p] of pages.entries()) {
    await expect(p.getByTestId('fold-player')).toHaveAttribute('data-phase', /countdown|racing/);
    await p.locator('.forge-viewport canvas').click({ position: { x: 400, y: 300 }, force: true });
    await p.waitForFunction(() => !!document.pointerLockElement);
    await p.evaluate(installForgeBrowserDriver, {
      id: accounts[slot].id,
      slot,
      device: 'keyboard' as const,
    });
  }
  report.checks.push(
    'Actual WSS friend invitation, shared private lobby, both ready and synchronized start',
  );
  const duelStarted = Date.now(),
    shots = new Set<number>(),
    hits = new Set<number>();
  while (Date.now() - duelStarted < 660000) {
    const states = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => (window as unknown as { forgeState: ForgeState | null }).forgeState),
      ),
    );
    for (const s of states)
      for (const e of s?.events ?? []) {
        if (e.type === 'shot') shots.add(e.id);
        if (e.type === 'hit') hits.add(e.id);
      }
    if (states.every((s) => s?.phase === 'finished')) break;
    await pause(250);
  }
  for (const p of pages)
    await expect(p.getByTestId('fold-player')).toHaveAttribute('data-phase', 'results');
  const states = await Promise.all(
    pages.map((p) =>
      p.evaluate(() => (window as unknown as { forgeState: ForgeState }).forgeState),
    ),
  );
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[0].score, [5, 0]);
  assert(shots.size > 0 && hits.size > 0);
  assert(
    await a.evaluate(
      () => (window as unknown as { forgeDriver: { folded: boolean } }).forgeDriver.folded,
    ),
  );
  await expect(a.getByRole('button', { name: 'Вернуться в лобби', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const profiles = await Promise.all(pages.map((p) => get(p.request, '/api/fold-settings')));
  for (const profile of profiles) {
    const row = profile.history[0];
    assert(row?.result?.serverVerified && row.result.didFinish);
    assert.deepEqual(row.result.details.score, [5, 0]);
    report.records.push({
      matchId: row.matchId,
      place: row.result.place,
      serverVerified: true,
      didFinish: true,
      score: row.result.details.score,
    });
  }
  assert.equal(profiles[0].history[0].matchId, profiles[1].history[0].matchId);
  report.shots = shots.size;
  report.hits = hits.size;
  report.score = [5, 0];
  report.checks.push(
    'Five complete real network rounds, Fold geometry, authoritative hits and matching persisted results',
  );
  await a.getByRole('button', { name: 'Вернуться в лобби', exact: true }).click();
  for (const p of pages) {
    await expect(p.getByTestId('fold-player')).toHaveAttribute('data-phase', 'lobby');
    await p.getByRole('button', { name: 'Выйти из комнаты', exact: true }).click();
  }
  report.checks.push('Rematch lobby and explicit exit');
  assert(report.websocketOrigins.includes('wss://nexus-multiplayer.onrender.com'));
  assert.equal(report.errors.length, 0);
  report.passed = true;
  await publish('passed');
} catch (e) {
  report.failure = {
    name: e instanceof Error ? e.name : 'Unknown',
    stage,
    sourceLine:
      e instanceof Error ? e.stack?.match(/verify-forge-public\.ts:(\d+)/)?.[1] : undefined,
  };
  // No raw Playwright error/trace can expose cookies, form values or signed URLs.
  await fs.writeFile(
    (process.env.RUNNER_TEMP ?? '/tmp') + '/forge-public-error-private.txt',
    e instanceof Error ? (e.stack ?? e.name) : 'Unknown',
    { mode: 0o600 },
  );
  await publish('failed');
  process.exitCode = 1;
} finally {
  for (const b of browsers) await b.close();
  for (const a of apiClients) await a.dispose();
}
