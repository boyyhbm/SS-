import { test, expect, chromium, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isolateRegistrationQuota } from '../helpers/registration-quota';
import { defaultForgeSettings } from '../../src/games/fold/settings';
import { installForgeBrowserDriver } from '../helpers/forge-browser-driver';
import type { ForgeState } from '../../src/games/fold/contracts';
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const ids: string[] = [];
const post = (p: Page, url: string, data: unknown) =>
  p.request.post(origin + url, { headers: { Origin: origin }, data });
test.beforeAll(() => isolateRegistrationQuota(db));
test.afterAll(async () => {
  await db.multiplayerMatch.deleteMany({
    where: { participants: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
  });
  await db.user.deleteMany({ where: { id: { in: ids }, username: { startsWith: 'forgeweb_' } } });
  await db.$disconnect();
});
test('two independent accounts play a server-verified Fold duel with different input devices', async () => {
  test.setTimeout(720000);
  const recording = process.env.NEXUS_CAPTURE_ONLINE === '1';
  const artCapture = process.env.NEXUS_FORGE_ART_CAPTURE === '1';
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
    browsers.map((b, index) =>
      b.newContext({
        baseURL: origin,
        viewport: { width: 960, height: 650 },
        deviceScaleFactor: Number(process.env.E2E_SOFTWARE_DPR ?? 1),
        ...(recording && index === 0
          ? { recordVideo: { dir: 'storage/forge-recordings', size: { width: 960, height: 650 } } }
          : {}),
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const videoWallStart = Date.now();
  const errors: string[] = [];
  const report = {
    date: new Date().toISOString(),
    passed: false,
    independentAccounts: 2,
    independentBrowserProcesses: 2,
    realVideo: recording,
    scope:
      'Virtual standard Gamepad API and normal keyboard/Pointer Lock mouse events; read-only server-state observations, no pose/health/result injection. Not physical hardware or real-player skill testing.',
    inputMethods: ['virtual gamepad', 'keyboard / mouse'],
    checks: [] as string[],
    performance: [] as unknown[],
    errors,
    recordedFiles: [] as string[],
    audio: [] as { samples: number; peak: number; maximumRms: number }[],
    observedShots: 0,
    observedHits: 0,
    lastRoundReason: '',
    videoMatchStartSeconds: 0,
    videoMatchEndSeconds: 0,
    audioRecording: null as { path: string; offsetSeconds: number } | null,
    startClicks: 0,
    graphics: artCapture ? 'Medium client A / Competitive client B; reduced software backing resolution' : 'Competitive; functional software-GPU verification',
    foldTransitions: [new Set<string>(), new Set<string>()],
    screenshots: [] as string[],
  };
  try {
    for (const [i, p] of pages.entries()) {
      p.setDefaultTimeout(30000);
      p.on('pageerror', (e) => errors.push(e.name));
      await p.addInitScript(() => {
        type ProbeWindow = Window & {
          forgeState: ForgeState | null;
          forgeStats: unknown[];
          forgePad: { axes: number[]; buttons: number[] };
          forgeKeyboard: Set<string>;
          forgeAim: { yaw: number; pitch: number } | null;
        };
        const w = window as unknown as ProbeWindow;
        w.forgeState = null;
        w.forgeStats = [];
        w.forgePad = { axes: [0, 0, 0, 0], buttons: Array(17).fill(0) };
        w.forgeKeyboard = new Set();
        w.forgeAim = null;
        window.addEventListener('nexus-forge-aim', (e) => {
          w.forgeAim = (e as CustomEvent).detail;
        });
        window.addEventListener('nexus-forge-state', (e) => {
          w.forgeState = (e as CustomEvent).detail;
        });
        window.addEventListener('nexus-forge-frame', (e) => {
          w.forgeStats.push((e as CustomEvent).detail.stats);
          if (w.forgeStats.length > 200) w.forgeStats.shift();
        });
      });
      await p.addInitScript('globalThis.__name=(fn)=>fn;');
      await p.addInitScript(
        (captureAudio: boolean) => {
          const w = window as unknown as {
            forgeAudio: { samples: number; peak: number; maximumRms: number };
            forgeAudioRecorder?: MediaRecorder;
            forgeAudioChunks: Blob[];
            forgeAudioStarted?: number;
          };
          w.forgeAudio = { samples: 0, peak: 0, maximumRms: 0 };
          w.forgeAudioChunks = [];
          const original = AudioNode.prototype.connect,
            seen = new WeakSet<BaseAudioContext>(),
            probes: { node: AnalyserNode; data: Float32Array<ArrayBuffer> }[] = [];
          Object.defineProperty(AudioNode.prototype, 'connect', {
            configurable: true,
            value: function (this: AudioNode, ...args: unknown[]) {
              if (args[0] instanceof AudioDestinationNode && !seen.has(this.context)) {
                seen.add(this.context);
                const node = this.context.createAnalyser();
                node.fftSize = 256;
                Reflect.apply(original, this, [node]);
                probes.push({ node, data: new Float32Array(256) });
                if (captureAudio) {
                  const destination = (this.context as AudioContext).createMediaStreamDestination();
                  Reflect.apply(original, this, [destination]);
                  const recorder = new MediaRecorder(destination.stream, {
                    mimeType: 'audio/webm;codecs=opus',
                  });
                  w.forgeAudioRecorder = recorder;
                  recorder.ondataavailable = (e) => {
                    if (e.data.size) w.forgeAudioChunks.push(e.data);
                  };
                  w.forgeAudioStarted = Date.now();
                  recorder.start(500);
                }
              }
              return Reflect.apply(original, this, args);
            },
          });
          setInterval(() => {
            for (const probe of probes) {
              probe.node.getFloatTimeDomainData(probe.data);
              let power = 0;
              for (const value of probe.data) {
                power += value * value;
                w.forgeAudio.peak = Math.max(w.forgeAudio.peak, Math.abs(value));
              }
              w.forgeAudio.maximumRms = Math.max(
                w.forgeAudio.maximumRms,
                Math.sqrt(power / probe.data.length),
              );
              w.forgeAudio.samples++;
            }
          }, 50);
        },
        recording && i === 0,
      );
      if (i === 0)
        await p.addInitScript(() => {
          Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => {
              const p = (window as unknown as { forgePad: { axes: number[]; buttons: number[] } })
                .forgePad;
              return [
                {
                  id: 'NEXUS virtual QA controller',
                  mapping: 'standard',
                  index: 0,
                  connected: true,
                  timestamp: performance.now(),
                  axes: p.axes,
                  buttons: p.buttons.map((value) => ({
                    value,
                    pressed: value > 0.5,
                    touched: value > 0,
                  })),
                },
              ];
            },
          });
        });
      const username = 'forgeweb_' + randomBytes(5).toString('hex'),
        password = randomBytes(18).toString('hex');
      const registration = await post(p, '/api/register', {
        username,
        email: username + '@example.test',
        password,
        confirmPassword: password,
      });
      expect(registration.status()).toBe(201);
      const user = await db.user.findUniqueOrThrow({ where: { username } });
      ids.push(user.id);
      await p.goto('/login');
      await p.locator('[name=email]').fill(user.email);
      await p.locator('[name=password]').fill(password);
      await p.locator('.auth-submit').click();
      await p.waitForURL(origin + '/');
      const data = await (await p.request.get('/api/console')).json(),
        game = data.games.find((g: { slug: string }) => g.slug === 'fold-zero');
      expect(game).toBeTruthy();
      expect((await post(p, '/api/library', { action: 'add', gameId: game.id })).status()).toBe(
        200,
      );
      expect(
        (
          await post(p, '/api/fold-settings', { ...defaultForgeSettings, quality: artCapture && i === 0 ? 'medium' : 'competitive' })
        ).status(),
      ).toBe(200);
      await p.goto('/play/fold-zero');
      await expect(p.getByTestId('fold-player')).toHaveAttribute('data-loaded', 'true', {
        timeout: 90000,
      });
      console.log(JSON.stringify({ forgeStage: 'client ready', client: i }));
    }
    report.checks.push('NEXUS registration, personal library, runtime launch and saved settings');
    const [a, b] = pages;
    const consoleData = await (await b.request.get('/api/console')).json();
    // Actual friend request/accept and actual game invitation, using platform APIs.
    expect(
      (
        await post(a, '/api/social', { action: 'request', username: consoleData.user.username })
      ).status(),
    ).toBe(200);
    const social = await (await b.request.get('/api/social')).json();
    expect(
      (
        await post(b, '/api/social', {
          action: 'accept',
          id: social.incoming.find((r: { senderId: string }) => r.senderId === ids[0]).id,
        })
      ).status(),
    ).toBe(200);
    await a.getByRole('button', { name: 'Private Duel', exact: true }).click();
    await expect(a.getByTestId('forge-ready')).toBeVisible();
    await a.getByRole('button', { name: 'Пригласить друга', exact: true }).click();
    const sent = a.waitForResponse(
      (r) => r.url().endsWith('/api/social') && r.request().method() === 'POST',
    );
    await a.getByRole('button', { name: consoleData.user.username, exact: true }).click();
    expect((await sent).status()).toBe(200);
    const invites = await (await b.request.get('/api/social')).json();
    const invite = invites.invites.find(
      (x: { game: { slug: string } }) => x.game?.slug === 'fold-zero',
    );
    expect(invite).toBeTruthy();
    await a.getByRole('button', { name: 'Назад', exact: true }).click();
    await b.goto('/online/fold-zero?room=' + encodeURIComponent(invite.roomId));
    await expect(b.getByTestId('forge-ready')).toBeVisible({ timeout: 90000 });
    await expect(a.locator('.forge-member strong').nth(1)).not.toHaveText('Ожидание соперника');
    report.checks.push('Friend request, acceptance, private invitation and common lobby');
    for (const p of pages) await p.getByTestId('forge-ready').click();
    await expect(a.getByTestId('forge-start')).toBeEnabled();
    report.videoMatchStartSeconds = (Date.now() - videoWallStart) / 1000;
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await a.getByTestId('fold-player').getAttribute('data-phase')) !== 'lobby') break;
      await a.getByTestId('forge-start').click();
      report.startClicks++;
      try {
        await expect(a.getByTestId('fold-player')).toHaveAttribute(
          'data-phase',
          /countdown|racing/,
          { timeout: 5000 },
        );
        break;
      } catch {
        if (attempt === 2) throw Error('Start was not acknowledged');
      }
    }
    await Promise.all(
      pages.map((p) =>
        expect(p.getByTestId('fold-player')).toHaveAttribute('data-phase', /countdown|racing/),
      ),
    );
    // The keyboard client captures the mouse through the real Pointer Lock API.
    await b.locator('.forge-viewport canvas').click({ position: { x: 400, y: 300 }, force: true });
    await b.waitForFunction(() => !!document.pointerLockElement);
    console.log(JSON.stringify({ forgeStage: 'duel started' }));
    for (const [slot, p] of pages.entries())
      await p.evaluate(installForgeBrowserDriver, { id: ids[slot], slot, tour: artCapture });
    const started = Date.now();
    let lastProbe = 0;
    let previousRound = 0;
    const shots = new Set<number>(),
      hits = new Set<number>();
    while (Date.now() - started < 600000) {
      const clients = await Promise.all(
        pages.map((p) =>
          p.evaluate(() => ({
            game: (window as unknown as { forgeState: ForgeState | null }).forgeState,
            driver: (window as unknown as { forgeDriver: unknown }).forgeDriver,
          })),
        ),
      );
      for (const [index, client] of clients.entries()) {
        for (const node of client.game?.nodes ?? [])
          if (node.state === 1) report.foldTransitions[index].add(node.id + ':1');
        for (const e of client.game?.events ?? []) {
          if (e.type === 'shot') shots.add(e.id);
          if (e.type === 'hit') hits.add(e.id);
        }
      }
      if (artCapture && clients[0].game?.phase === 'active') {
        const p = clients[0].game.players.find(p => p.id === ids[0]);
        const zone = p ? p.x < -15 ? 'industrial' : p.x > 15 ? 'research' : 'central' : null;
        if (zone && !report.screenshots.some(path => path.endsWith(zone + '.png'))) {
          await fs.mkdir('public/reports/fold-controls/gameplay', { recursive: true });
          const path = 'public/reports/fold-controls/gameplay/' + zone + '.png';
          await a.screenshot({ path }); report.screenshots.push(path);
        }
      }
      if (clients[0].game?.round !== previousRound) {
        previousRound = clients[0].game?.round ?? 0;
        console.log(JSON.stringify({ forgeRound: previousRound, score: clients[0].game?.score }));
      }
      if (Date.now() - lastProbe > 5000) {
        lastProbe = Date.now();
        await fs.writeFile(
          '/tmp/nexus-forge-browser-probe.json',
          JSON.stringify({ date: new Date().toISOString(), clients }),
          { mode: 0o600 },
        );
      }
      if (clients.every((c) => c.game?.phase === 'finished')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const p of pages)
      await expect(p.getByTestId('fold-player')).toHaveAttribute('data-phase', 'results');
    const outcomes = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => (window as unknown as { forgeState: ForgeState }).forgeState),
      ),
    );
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0].score).toEqual([5, 0]);
    report.observedShots = shots.size;
    report.observedHits = hits.size;
    report.lastRoundReason = outcomes[0].reason;
    expect(shots.size).toBeGreaterThan(0);
    expect(hits.size).toBeGreaterThan(0);
    expect(report.foldTransitions.every(nodes => nodes.has('shutter:1'))).toBe(true);
    const records = await db.matchParticipant.findMany({
      where: { userId: { in: ids }, match: { game: { slug: 'fold-zero' }, status: 'FINISHED' } },
      include: { result: true },
    });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.result?.serverVerified && r.result.didFinish)).toBe(true);
    report.videoMatchEndSeconds = (Date.now() - videoWallStart) / 1000;
    report.checks.push(
      'Synchronized start, two different input paths, real movement, fold geometry, server hit registration, five rounds, identical persisted results',
    );
    await expect(a.getByRole('button', { name: 'Вернуться в лобби' })).toBeEnabled();
    await a.getByRole('button', { name: 'Вернуться в лобби' }).click();
    for (const p of pages)
      await expect(p.getByTestId('fold-player')).toHaveAttribute('data-phase', 'lobby');
    report.checks.push('Return to lobby');
    for (const p of pages) {
      report.performance.push(
        await p.evaluate(() => (window as unknown as { forgeStats: unknown[] }).forgeStats),
      );
      report.audio.push(
        await p.evaluate(
          () =>
            (
              window as unknown as {
                forgeAudio: { samples: number; peak: number; maximumRms: number };
              }
            ).forgeAudio,
        ),
      );
    }
    expect(report.audio.every((a) => a.samples > 0 && a.maximumRms > 0.0001 && a.peak < 1)).toBe(
      true,
    );
    report.checks.push('Actual Web Audio output is non-silent and has digital headroom');
    if (recording) {
      const capture = await a.evaluate(async () => {
        const w = window as unknown as {
          forgeAudioRecorder?: MediaRecorder;
          forgeAudioChunks: Blob[];
          forgeAudioStarted: number;
        };
        const recorder = w.forgeAudioRecorder;
        if (!recorder) throw Error('Audio recording unavailable');
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(new Blob(w.forgeAudioChunks, { type: 'audio/webm' }));
        });
        return { base64, started: w.forgeAudioStarted };
      });
      await fs.mkdir('storage/forge-recordings', { recursive: true });
      const path = 'storage/forge-recordings/audio-' + Date.now() + '.webm';
      await fs.writeFile(path, Buffer.from(capture.base64, 'base64'));
      report.audioRecording = { path, offsetSeconds: (capture.started - videoWallStart) / 1000 };
    }
    await a.getByRole('button', { name: 'Выйти из комнаты', exact: true }).click();
    await a.getByRole('button', { name: 'Статистика', exact: true }).click();
    await expect(a.locator('.forge-records strong').first()).toContainText('1');
    report.checks.push('Saved match statistics refresh in the in-game profile');
    expect(errors).toEqual([]);
    report.passed = true;
  } finally {
    await fs.mkdir('docs/fold-controls', { recursive: true });
    for (const c of contexts) await c.close();
    if (recording)
      for (const p of pages) {
        const path = await p.video()?.path();
        if (path) report.recordedFiles.push(path);
      }
    await fs.writeFile('docs/fold-controls/gameplay.json', JSON.stringify({ ...report, foldTransitions: report.foldTransitions.map(nodes => [...nodes]) }, null, 2) + '\n');
    for (const b of browsers) await b.close();
  }
});
