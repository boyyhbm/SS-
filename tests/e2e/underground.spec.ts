import { test, expect } from './fixtures';
import type { Frame, Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { EXE_TIMESTAMP, UPSTREAM_REVISION } from '../../src/games/underground/contracts';
import type * as StorageAPI from '../../integrations/underground/storage';
import { defaultConfig } from '../../src/input/profiles';
import { isolateRegistrationQuota } from '../helpers/registration-quota';
import {
  CTL_INTS,
  CTL_IO_DOORBELL,
  RPC_BYTES,
  RPC_DONE,
  RPC_POSTED,
  Op,
} from '../../vendor/nfsu1-web/src/host/proto';

declare global {
  interface Window {
    __nfsuStorageTest: typeof StorageAPI;
    __nfsuMessages: { origin: string; data: unknown }[];
  }
}
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const prefix = 'nfsu_qa_' + Date.now().toString(36) + '_' + randomBytes(3).toString('hex');
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const ordered = <T extends { path: string }>(files: T[]) =>
  [...files].sort((a, b) => a.path.localeCompare(b.path));
const errors: string[] = [];
let fixtureRoot: string, storageBundle: string;
async function register(page: Page, suffix: string) {
  await page.goto('/register');
  await page.locator('[name=username]').fill('nfsu_' + randomBytes(5).toString('hex'));
  await page.locator('[name=email]').fill(prefix + '_' + suffix + '@example.test');
  await page.locator('[name=password]').fill('Nexus QA local-only 2026');
  await page.locator('[name=confirmPassword]').fill('Nexus QA local-only 2026');
  await page.getByRole('button', { name: 'Создать свой профиль' }).click();
  await expect(page).toHaveURL('/');
}
async function launch(page: Page, direct = true) {
  await page.goto('/games/need-for-speed-underground');
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.getByRole('button', { name: /Настроить \/ запустить/ }).click();
  await expect(page).toHaveURL('/play/need-for-speed-underground');
  await expect(page.getByTestId('underground-launcher')).toBeVisible();
  const iframe = page.locator('iframe[title="Локальный runtime Need for Speed Underground"]');
  await expect(iframe).toBeVisible();
  const frame = await (await iframe.elementHandle())!.contentFrame();
  if (!frame) throw Error('No runtime frame');
  await expect(frame.locator('#setup')).toBeVisible();
  await expect(frame.locator('#compatibility')).not.toContainText('Проверяем');
  if (direct) {
    await page.getByRole('button', { name: 'Открыть отдельный запуск', exact: true }).click();
    await expect(page).toHaveURL(/\/nfsu\/#launch=/);
    const local = page.mainFrame();
    await expect(local.locator('#setup')).toBeVisible();
    await expect(local.locator('#package')).toContainText('Комплект ещё не выбран');
    return local;
  }
  return frame;
}
async function injectStorage(frame: Frame) {
  await frame.evaluate(storageBundle);
  return frame.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (
      root as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }
    ).keys())
      if (/^nexus-nfsu-[a-f0-9]{64}$/.test(name)) names.push(name.slice('nexus-nfsu-'.length));
    if (names.length !== 1) throw Error('Expected one initialized local account namespace');
    return names[0];
  });
}
function saveArchive(text = 'BPP: 32\nRES: 0\n') {
  // Authored header/byte fixture, not an original playable career profile.
  const opt = Buffer.alloc(48);
  opt.writeUInt32LE(0x13, 0);
  opt.write('NEXUS_QA', 8);
  const index = Buffer.alloc(36);
  index.writeUInt32LE(1, 0);
  index.write('NEXUS_QA', 4);
  const entries = [
    ['NFS Underground/NEXUS_QA.cfg', Buffer.from(text)],
    ['NFS Underground/NEXUS_QA.opt', opt],
    ['NFS Underground/Profiles.usr', index],
  ] as const;
  return {
    format: 'nexus-nfsu-saves/v1',
    gameVersion: '1.4',
    createdAt: new Date().toISOString(),
    files: entries.map(([p, bytes]) => ({
      path: p,
      bytes: bytes.length,
      sha256: hash(bytes),
      base64: bytes.toString('base64'),
    })),
  };
}
async function preparedFolder(name: string, corrupt = false) {
  const folder = path.join(fixtureRoot, name);
  await fs.mkdir(path.join(folder, 'runtime'), { recursive: true });
  await fs.mkdir(path.join(folder, 'data'), { recursive: true });
  const exe = Buffer.alloc(512);
  exe.writeUInt16LE(0x5a4d, 0);
  exe.writeUInt32LE(128, 0x3c);
  exe.writeUInt32LE(0x4550, 128);
  exe.writeUInt16LE(0x14c, 132);
  exe.writeUInt32LE(EXE_TIMESTAMP, 136);
  exe.writeUInt16LE(0x10b, 152);
  exe.writeUInt32LE(0x400000, 180);
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const manifest = {
    format: 'nexus-nfsu-local/v1',
    upstreamRevision: UPSTREAM_REVISION,
    exe: { version: '1.4', peTimestamp: EXE_TIMESTAMP, sha256: hash(exe) },
    module: {
      path: 'runtime/nfsu1.wasm',
      sha256: hash(wasm),
      size: wasm.length,
      info: {
        pages: 16384,
        maxPages: 65536,
        guestEnd: 671088640,
        rev: 'OWNED FORMAT FIXTURE NOT A GAME',
        opt: 'O2',
        lift: 'plain',
        size: wasm.length,
      },
    },
    files: [{ path: 'SPEED.EXE', size: exe.length, mtime: 1, sha256: hash(exe) }],
    directories: [],
  };
  await fs.writeFile(path.join(folder, 'nexus-nfsu-package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(folder, 'runtime/nfsu1.wasm'), wasm);
  if (corrupt) exe[400] = 1;
  await fs.writeFile(path.join(folder, 'data/SPEED.EXE'), exe);
  return folder;
}

test.beforeAll(async () => {
  await isolateRegistrationQuota(db);
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nfsu-browser-format-fixtures-'));
  const bundled = await build({
    entryPoints: ['integrations/underground/storage.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__nfsuStorageTest',
    platform: 'browser',
    target: 'chrome140',
  });
  storageBundle =
    bundled.outputFiles[0].text + '\n;globalThis.__nfsuStorageTest=__nfsuStorageTest;';
});
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__nfsuMessages = [];
    window.addEventListener('message', (event) =>
      window.__nfsuMessages.push({ origin: event.origin, data: event.data }),
    );
  });
});
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await db.$disconnect();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('real NEXUS library launch uses isolated two-origin iframe and never shares account credentials', async ({
  page,
}) => {
  await register(page, 'bridge');
  const savedController = defaultConfig();
  savedController.steeringSensitivity = 1.7;
  savedController.bindings.accelerate = { kind: 'button', index: 5 };
  const saved = await page.request.post('/api/controllers', {
    headers: { Origin: new URL(origin).origin },
    data: {
      action: 'save',
      name: 'Underground QA mapping',
      deviceKey: null,
      config: savedController,
    },
  });
  expect(saved.ok()).toBe(true);
  const frame = await launch(page, false);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await frame.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(new URL(frame.url()).hostname).not.toBe(new URL(page.url()).hostname);
  const headers = (await page.request.get('/play/need-for-speed-underground')).headers();
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  const data = await frame.evaluate(() => ({
    cookie: document.cookie,
    messages: window.__nfsuMessages,
    shared: typeof SharedArrayBuffer,
    opfs: !!navigator.storage.getDirectory,
  }));
  expect(data.cookie).toBe('');
  expect(data.shared).toBe('function');
  expect(data.opfs).toBe(true);
  const init = data.messages.find((m) => (m.data as { type?: string })?.type === 'init')?.data as {
    payload: Record<string, unknown>;
  };
  expect(init).toBeTruthy();
  expect(Object.keys(init.payload).sort()).toEqual(['controls', 'namespace']);
  expect(init.payload.namespace).toMatch(/^[a-f0-9]{64}$/);
  expect(init.payload.controls).toEqual(savedController);
  expect(JSON.stringify(data.messages)).not.toMatch(
    /password|session-token|next-auth|@example\.test/,
  );
  await expect(frame.locator('#play')).toBeDisabled();
  await expect(frame.locator('#package')).toHaveText(
    /Комплект ещё не выбран|Для доступа к файлам нужен отдельный запуск/,
  );
  // The real child origin/source with the wrong nonce must not navigate the parent.
  await frame.evaluate(
    (parent) =>
      window.parent.postMessage(
        { protocol: 'nexus-nfsu', version: 1, nonce: crypto.randomUUID(), type: 'exit' },
        parent,
      ),
    new URL(origin).origin,
  );
  // A parent-window sender pretending to have the child origin/source must not pass the source check.
  await page.evaluate(() => {
    const f = document.querySelector('iframe')!;
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: new URL(f.src).origin,
        source: window,
        data: {
          protocol: 'nexus-nfsu',
          version: 1,
          nonce: new URL(f.src).hash.slice(1),
          type: 'exit',
        },
      }),
    );
  });
  await expect(page).toHaveURL('/play/need-for-speed-underground');
  await page.getByRole('button', { name: 'Открыть отдельный запуск', exact: true }).click();
  await expect(page).toHaveURL(/\/nfsu\/#launch=/);
  await expect(page.locator('#package')).toContainText('Комплект ещё не выбран');
  expect(
    await page.evaluate(async () => {
      await navigator.storage.getDirectory();
      return document.cookie;
    }),
  ).toBe('');
  await fs.mkdir('docs/underground/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/underground/screenshots/launcher.png', fullPage: true });
  await page.getByRole('button', { name: 'Вернуться в NEXUS' }).click();
  await expect(page).toHaveURL('/library');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
});

test('OPFS prepared-folder verification preserves the previous installation after corrupt replacement, without uploads', async ({
  page,
}) => {
  await register(page, 'package');
  const frame = await launch(page),
    namespace = await injectStorage(frame);
  const uploaded: string[] = [];
  page.context().on('request', (request) => {
    if (new URL(request.url()).origin === new URL(frame.url()).origin && request.method() !== 'GET')
      uploaded.push(request.url());
  });
  await frame.locator('#package-input').setInputFiles(await preparedFolder('format-only-good'));
  await expect(frame.locator('#status')).toContainText('Комплект проверен');
  await expect(frame.locator('#package')).toContainText('1 файлов');
  const before = await frame.evaluate(async (ns) => {
    const data = await window.__nfsuStorageTest.cachedPackage(ns);
    return {
      dir: data?.dataDir,
      hash: data ? await window.__nfsuStorageTest.digest(data.module) : null,
    };
  }, namespace);
  const hostIO = await frame.evaluate(
    async ({ ns, layout }) => {
      // Real MIT I/O worker and shared WASI mailbox; authored bytes only, no game Wasm or game simulation.
      const api = window.__nfsuStorageTest,
        data = (await api.cachedPackage(ns))!,
        folder = await api.saveDirectory(ns);
      const files = [
        ...data.manifest.files.map((f) => ({ p: f.path, s: f.size, m: f.mtime })),
        { p: 'missing-owned-fixture.txt', s: 4, m: 1 },
      ];
      const manifestUrl = URL.createObjectURL(
        new Blob([JSON.stringify({ files })], { type: 'application/json' }),
      );
      const memory = new WebAssembly.Memory({ initial: 2, maximum: 2, shared: true }),
        ctlBuffer = new SharedArrayBuffer(layout.ctlInts * 4),
        rpcBuffer = new SharedArrayBuffer(layout.rpcBytes);
      const ctl = new Int32Array(ctlBuffer),
        rpc = new Int32Array(rpcBuffer),
        args = new BigInt64Array(rpcBuffer),
        bytes = new Uint8Array(memory.buffer),
        view = new DataView(memory.buffer);
      const worker = new Worker('/nfsu/host/io-worker.js', { type: 'module' });
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('I/O worker bootstrap timeout')), 10000);
          worker.onerror = (e) => {
            clearTimeout(timeout);
            reject(Error(e.message));
          };
          worker.onmessage = (e) => {
            if (e.data.t === 'io-ready') {
              clearTimeout(timeout);
              resolve();
            } else if (e.data.t === 'io-error') {
              clearTimeout(timeout);
              reject(Error(e.data.msg));
            }
          };
          worker.postMessage({
            memory,
            ctl: ctlBuffer,
            rpc: rpcBuffer,
            cfg: {
              args: [],
              env: {},
              dataBase: 'nexus-local:',
              manifestUrl,
              cacheDir: data.dataDir,
              saveDir: folder.name,
            },
          });
        });
        const call = async (op: number, parameters: number[]) => {
          rpc[1] = op;
          rpc[3] = parameters.length;
          parameters.forEach((value, i) => {
            args[i + 2] = BigInt(value);
          });
          Atomics.store(rpc, 0, layout.posted);
          Atomics.add(ctl, layout.doorbell, 1);
          Atomics.notify(ctl, layout.doorbell);
          for (;;) {
            const state = Atomics.load(rpc, 0);
            if (state === layout.done) break;
            const waiting = Atomics.waitAsync(rpc, 0, state, 5000);
            if (waiting.async && (await waiting.value) === 'timed-out')
              throw Error('I/O mailbox timeout');
          }
          const error = rpc[2];
          Atomics.store(rpc, 0, 0);
          return error;
        };
        const open = async (name: string) => {
          bytes.set(new TextEncoder().encode(name), 64);
          const error = await call(layout.open, [3, 0, 64, name.length, 0, 2, 0, 0, 256]);
          if (error) throw Error('Local fixture open failed: ' + error);
          return view.getUint32(256, true);
        };
        const read = async (fd: number) => {
          view.setUint32(300, 512, true);
          view.setUint32(304, 512, true);
          return call(layout.read, [fd, 300, 1, 280]);
        };
        const fd = await open('SPEED.EXE'),
          readError = await read(fd),
          count = view.getUint32(280, true),
          signature = [bytes[512], bytes[513]];
        await call(layout.close, [fd]);
        const missing = await open('missing-owned-fixture.txt'),
          missingError = await read(missing);
        await call(layout.close, [missing]);
        return { readError, count, signature, missingError };
      } finally {
        worker.terminate();
        URL.revokeObjectURL(manifestUrl);
      }
    },
    {
      ns: namespace,
      layout: {
        ctlInts: CTL_INTS,
        rpcBytes: RPC_BYTES,
        doorbell: CTL_IO_DOORBELL,
        posted: RPC_POSTED,
        done: RPC_DONE,
        open: Op.PathOpen,
        read: Op.FdRead,
        close: Op.FdClose,
      },
    },
  );
  expect(hostIO).toEqual({ readError: 0, count: 512, signature: [77, 90], missingError: 29 });
  await frame
    .locator('#package-input')
    .setInputFiles(await preparedFolder('format-only-corrupt', true));
  await expect(frame.locator('#status')).toContainText('Повреждён файл комплекта');
  const after = await frame.evaluate(async (ns) => {
    const data = await window.__nfsuStorageTest.cachedPackage(ns);
    return {
      dir: data?.dataDir,
      hash: data ? await window.__nfsuStorageTest.digest(data.module) : null,
    };
  }, namespace);
  expect(after).toEqual(before);
  expect(uploaded).toEqual([]);
  // No actual game is started from this empty authored Wasm fixture.
  await page.reload();
  await expect(page.locator('#package')).toContainText('Комплект найден');
});

test('local save import/export/backup survives reload, rolls back an I/O failure, and separates accounts', async ({
  page,
}) => {
  test.setTimeout(120000);
  await register(page, 'saves-a');
  let frame = await launch(page);
  const namespace = await injectStorage(frame);
  const archive = saveArchive(),
    file = path.join(fixtureRoot, 'owned-save-format.json');
  await fs.writeFile(file, JSON.stringify(archive));
  await frame.locator('#save-input').setInputFiles(file);
  await expect(frame.locator('#status')).toContainText('Сохранения импортированы');
  await expect(frame.locator('#save-list li')).toHaveCount(3);
  const downloaded = page.waitForEvent('download');
  await frame.locator('#export').click();
  const filePath = await (await downloaded).path();
  expect(filePath).toBeTruthy();
  const actual = JSON.parse(await fs.readFile(filePath!, 'utf8'));
  expect(ordered(actual.files)).toEqual(ordered(archive.files));
  await frame.locator('#backup').click();
  await expect(frame.locator('#status')).toContainText(/резервная копия создана/i);
  const backup = await frame.locator('#backups option').first().getAttribute('value');
  expect(backup).toBeTruthy();
  const updated = saveArchive('BPP: 16\nRES: 2\n');
  await fs.writeFile(file, JSON.stringify(updated));
  await frame.locator('#save-input').setInputFiles(file);
  await expect(frame.locator('#status')).toContainText('Сохранения импортированы');
  await frame.locator('#backups').selectOption(backup!);
  await frame.locator('#restore').click();
  await expect(frame.locator('#status')).toContainText('Резервная копия восстановлена');
  const rollback = await frame.evaluate(
    async ({ ns, value }) => {
      const api = window.__nfsuStorageTest,
        before = await api.exportSaves(ns),
        old = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function (...args) {
        if (this.name.endsWith('.cfg')) throw Error('Owned fixture write failure');
        return old.apply(this, args);
      };
      let rejected = false;
      try {
        await api.importSaves(ns, new File([JSON.stringify(value)], 'fixture.json'));
      } catch {
        rejected = true;
      } finally {
        FileSystemFileHandle.prototype.createWritable = old;
      }
      return { rejected, before: before.files, after: (await api.exportSaves(ns)).files };
    },
    { ns: namespace, value: updated },
  );
  expect(rollback.rejected).toBe(true);
  expect(ordered(rollback.after)).toEqual(ordered(rollback.before));
  expect(ordered(rollback.after)).toEqual(ordered(archive.files));
  const bad = {
    ...archive,
    files: archive.files.map((f, i) => (i ? f : { ...f, sha256: '0'.repeat(64) })),
  };
  await fs.writeFile(file, JSON.stringify(bad));
  await frame.locator('#save-input').setInputFiles(file);
  await expect(frame.locator('#status')).toContainText('Повреждён архив');
  await page.reload();
  frame = page.mainFrame();
  await expect(frame.locator('#save-list li')).toHaveCount(3);
  await page.screenshot({ path: 'docs/underground/screenshots/local-saves.png', fullPage: true });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/');
  await register(page, 'saves-b');
  frame = await launch(page);
  await expect(frame.locator('#save-list li')).toHaveCount(0);
  await expect(frame.locator('#package')).toContainText('Комплект ещё не выбран');
  await expect(frame.locator('#save-empty')).toContainText('Сохранений пока нет');
});
