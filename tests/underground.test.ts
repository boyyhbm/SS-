import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import {
  accountNamespace,
  bridgeSchema,
  cacheFilename,
  EXE_TIMESTAMP,
  initSchema,
  inspectExecutable,
  packageSchema,
  parseDirectLaunch,
  safeRelativePath,
  UPSTREAM_REVISION,
  validateThreadedModule,
} from '../src/games/underground/contracts';
import { undergroundOrigin } from '../src/games/underground/origin';
import { undergroundStatic } from '../server/underground-static';
import { defaultConfig } from '../src/input/profiles';
import { setPadPreferences } from '../integrations/underground/pad';
import { mapStandard } from '../vendor/nfsu1-web/src/input/gamepad';
import { PAD_AXIS_LT, PAD_AXIS_RT, PAD_AXIS_LX, PAD_B } from '../vendor/nfsu1-web/src/input/proto';
import { startProcess } from '../vendor/nfsu1-web/src/host/process';

// Authored format fixtures only. These contain no original executable/code/assets.
const sha = 'a'.repeat(64);
const manifest = () => ({
  format: 'nexus-nfsu-local/v1',
  upstreamRevision: UPSTREAM_REVISION,
  exe: { version: '1.4', peTimestamp: EXE_TIMESTAMP, sha256: sha },
  module: {
    path: 'runtime/nfsu1.wasm',
    sha256: sha,
    size: 8,
    info: {
      pages: 16384,
      maxPages: 65536,
      guestEnd: 671088640,
      rev: 'format-fixture',
      opt: 'O2',
      lift: 'plain',
      size: 8,
    },
  },
  files: [{ path: 'SPEED.EXE', size: 512, mtime: 1, sha256: sha }],
  directories: [] as string[],
});
function header() {
  const bytes = new Uint8Array(512),
    d = new DataView(bytes.buffer);
  d.setUint16(0, 0x5a4d, true);
  d.setUint32(0x3c, 128, true);
  d.setUint32(128, 0x4550, true);
  d.setUint16(132, 0x14c, true);
  d.setUint32(136, EXE_TIMESTAMP, true);
  d.setUint16(152, 0x10b, true);
  d.setUint32(180, 0x400000, true);
  return bytes;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setPadPreferences(null);
});

describe('Underground local package boundaries (not gameplay)', () => {
  it('checks the actual PE layout and rejects another version, architecture and malformed offsets', () => {
    expect(inspectExecutable(header()).version).toBe('1.4');
    for (const offset of [0, 128, 132, 136, 152, 180]) {
      const bytes = header();
      bytes[offset] ^= 255;
      expect(() => inspectExecutable(bytes)).toThrow();
    }
    const bytes = header();
    new DataView(bytes.buffer).setUint32(0x3c, 0xffffffff, true);
    expect(() => inspectExecutable(bytes)).toThrow();
    expect(() => inspectExecutable(new Uint8Array(4))).toThrow();
  });
  it('rejects traversal, URLs, case collisions, missing parent directories and cache-key aliases', () => {
    for (const value of [
      '../save',
      '/absolute',
      'a//b',
      'a/./b',
      'a\\b',
      'https://site/file',
      'a?query',
      'x#fragment',
      'a\u0000b',
    ])
      expect(safeRelativePath(value)).toBe(false);
    expect(packageSchema.safeParse(manifest()).success).toBe(true);
    const duplicate = manifest();
    duplicate.files.push({ ...duplicate.files[0], path: 'speed.exe' });
    expect(packageSchema.safeParse(duplicate).success).toBe(false);
    const dir = manifest();
    dir.directories = ['SPEED.EXE'];
    expect(packageSchema.safeParse(dir).success).toBe(false);
    const nested = manifest();
    nested.files.push({ ...nested.files[0], path: 'CARS/car.bin' });
    expect(packageSchema.safeParse(nested).success).toBe(false);
    nested.directories = ['CARS'];
    expect(packageSchema.safeParse(nested).success).toBe(true);
    nested.files.push({ ...nested.files[1], path: 'CARS_car.bin' });
    expect(packageSchema.safeParse(nested).success).toBe(false);
    expect(cacheFilename({ path: 'CARS/car.bin', size: 42, mtime: 10 })).toBe('CARS_car.bin.42.10');
  });
  it('binds module metadata and executable hash without accepting remote game URLs', () => {
    const value = manifest();
    value.module.info.size++;
    expect(packageSchema.safeParse(value).success).toBe(false);
    const other = manifest();
    other.exe.sha256 = 'b'.repeat(64);
    expect(packageSchema.safeParse(other).success).toBe(false);
    expect(
      packageSchema.safeParse({ ...manifest(), dataUrl: 'https://game.example' }).success,
    ).toBe(false);
    expect(packageSchema.safeParse({ ...manifest(), upstreamRevision: 'main' }).success).toBe(
      false,
    );
    expect(() =>
      validateThreadedModule(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))),
    ).toThrow(/threaded WASI/);
  });
  it('separates account and origin namespaces, and rejects bridge credentials/unknown messages', async () => {
    const one = await accountNamespace('https://nexus.example', 'user-a');
    expect(one).toMatch(/^[a-f0-9]{64}$/);
    expect(one).toBe(await accountNamespace('https://nexus.example', 'user-a'));
    expect(one).not.toBe(await accountNamespace('https://nexus.example', 'user-b'));
    expect(one).not.toBe(await accountNamespace('https://other.example', 'user-a'));
    const message = {
      protocol: 'nexus-nfsu',
      version: 1,
      nonce: crypto.randomUUID(),
      type: 'ready',
    };
    expect(bridgeSchema.safeParse(message).success).toBe(true);
    expect(bridgeSchema.safeParse({ ...message, type: 'get-token' }).success).toBe(false);
    expect(bridgeSchema.safeParse({ ...message, token: 'secret' }).success).toBe(false);
    expect(initSchema.safeParse({ namespace: one, token: 'secret' }).success).toBe(false);
    const local = { ...message, type: 'init', payload: { namespace: one } };
    expect(
      parseDirectLaunch('#launch=' + encodeURIComponent(JSON.stringify(local)))?.context.namespace,
    ).toBe(one);
    expect(
      parseDirectLaunch(
        '#launch=' + encodeURIComponent(JSON.stringify({ ...local, token: 'secret' })),
      ),
    ).toBeNull();
    expect(parseDirectLaunch('#launch=malformed%')).toBeNull();
    expect(parseDirectLaunch('#launch=' + 'x'.repeat(25000))).toBeNull();
  });
  it('uses a different cookie hostname, not just a different port', () => {
    vi.stubEnv('NEXT_PUBLIC_NFSU_RUNTIME_ORIGIN', undefined);
    vi.stubEnv('NEXT_PUBLIC_MULTIPLAYER_URL', 'ws://localhost:2569');
    expect(undergroundOrigin('http://localhost:3002')).toBe('http://127.0.0.1:2569');
    vi.stubEnv('NEXT_PUBLIC_MULTIPLAYER_URL', 'wss://nexus.example:2569');
    expect(() => undergroundOrigin('https://nexus.example')).toThrow(/different host/);
    vi.stubEnv('NEXT_PUBLIC_MULTIPLAYER_URL', 'wss://runtime.example');
    expect(undergroundOrigin('https://nexus.example')).toBe('https://runtime.example');
    vi.stubEnv('NEXT_PUBLIC_MULTIPLAYER_URL', 'http://runtime.example');
    expect(() => undergroundOrigin('https://nexus.example')).toThrow();
  });
  it('retains analog trigger values and applies the real NEXUS steering/button profile to the upstream mailbox', () => {
    const config = defaultConfig();
    config.bindings.steer = { kind: 'axis', index: 2, sign: -1, mode: 'signed' };
    config.bindings.confirm = { kind: 'button', index: 1 };
    setPadPreferences(config);
    const buttons = Array.from({ length: 17 }, () => ({
      value: 0,
      pressed: false,
      touched: false,
    }));
    buttons[1] = { value: 1, pressed: true, touched: true };
    buttons[6].value = 0.31;
    buttons[7].value = 0.74;
    const pad = {
      id: 'Xbox test fixture',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0.575, 0],
      buttons,
    } as unknown as Gamepad;
    const snapshot = mapStandard(pad);
    expect(snapshot.axes[PAD_AXIS_LT]).toBeCloseTo(0.31);
    expect(snapshot.axes[PAD_AXIS_RT]).toBeCloseTo(0.74);
    expect(snapshot.axes[PAD_AXIS_LX]).toBeCloseTo(-0.5);
    config.swapConfirmCancel = true;
    setPadPreferences(config);
    expect(mapStandard(pad).buttons & (1 << PAD_B)).not.toBe(0);
  });
  it('the preparation utility documents local compilation and rejects an unsupported synthetic executable before building', async () => {
    const help = spawnSync(process.execPath, ['scripts/prepare-underground.mjs', '--help'], {
      encoding: 'utf8',
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('x86-to-C');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nfsu-reject-fixture-'));
    try {
      await fs.writeFile(path.join(temp, 'SPEED.EXE'), 'NOT AN EA EXECUTABLE');
      const r = spawnSync(
        process.execPath,
        ['scripts/prepare-underground.mjs', '--game', temp, '--check'],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Unsupported executable');
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});

it('serves only reviewed MIT browser resources with isolation headers and no game/upload endpoints', async () => {
  const app = express();
  app.use('/nfsu', undergroundStatic('https://nexus.example'));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No test server');
  const base = `http://127.0.0.1:${address.port}/nfsu/`;
  try {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('content-security-policy')).toContain(
      'frame-ancestors https://nexus.example',
    );
    expect(await response.text()).toContain('content="https://nexus.example"');
    expect((await fetch(base + 'host/io-worker.js')).status).toBe(200);
    for (const file of [
      'game.wasm',
      'runtime/nfsu1.wasm',
      'data/SPEED.EXE',
      'data-blocks',
      'anything.js',
    ])
      expect((await fetch(base + file)).status).toBe(404);
    expect((await fetch(base, { method: 'POST', body: 'no files' })).status).toBe(405);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('cancels and cleans all upstream process workers if I/O initialization is aborted or fails', async () => {
  class StubWorker extends EventTarget {
    static instances: StubWorker[] = [];
    static fail = false;
    static bootPool = false;
    static limit = Infinity;
    terminated = false;
    constructor() {
      super();
      if (StubWorker.instances.length >= StubWorker.limit) throw Error('fixture worker quota');
      StubWorker.instances.push(this);
    }
    postMessage() {
      if (StubWorker.bootPool && StubWorker.instances[0] === this)
        queueMicrotask(() =>
          this.dispatchEvent(new MessageEvent('message', { data: { t: 'io-ready' } })),
        );
      if (StubWorker.fail)
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent('message', { data: { t: 'io-error', msg: 'fixture I/O failure' } }),
          ),
        );
    }
    terminate() {
      this.terminated = true;
    }
  }
  vi.stubGlobal('Worker', StubWorker);
  const wasmModule = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const controller = new AbortController();
  const pending = startProcess({
    module: wasmModule,
    initialPages: 1,
    cfg: {
      args: [],
      env: {},
      dataBase: 'nexus-local:',
      manifestUrl: 'blob:fixture',
      saveDir: 'fixture',
    },
    signal: controller.signal,
  });
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(StubWorker.instances.every((w) => w.terminated)).toBe(true);
  StubWorker.fail = true;
  await expect(
    startProcess({
      module: wasmModule,
      initialPages: 1,
      cfg: {
        args: [],
        env: {},
        dataBase: 'nexus-local:',
        manifestUrl: 'blob:fixture',
        saveDir: 'fixture',
      },
    }),
  ).rejects.toThrow('fixture I/O failure');
  expect(StubWorker.instances.every((w) => w.terminated)).toBe(true);
  StubWorker.instances = [];
  StubWorker.fail = false;
  StubWorker.bootPool = true;
  StubWorker.limit = 2;
  await expect(
    startProcess({
      module: wasmModule,
      initialPages: 1,
      cfg: {
        args: [],
        env: {},
        dataBase: 'nexus-local:',
        manifestUrl: 'blob:fixture',
        saveDir: 'fixture',
      },
    }),
  ).rejects.toThrow('fixture worker quota');
  expect(StubWorker.instances.every((w) => w.terminated)).toBe(true);
});
