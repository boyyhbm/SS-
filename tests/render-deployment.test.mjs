import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  buildEnvironment,
  deploymentEnvironment,
  isPreparation,
} from '../scripts/deployment-env.mjs';
import { hasMount } from '../scripts/start-production.mjs';
import { validateProductionConfig } from '../scripts/production-config.mjs';

const base = {
  NODE_ENV: 'production',
  NEXUS_DEPLOYMENT: 'render',
  RENDER: 'true',
  NEXUS_LIVE: '1',
  NEXUS_SERVICE: 'web',
  PORT: '10000',
  DATABASE_URL: 'postgresql://nexus:fixture-only@dpg-fixture-a/nexus',
  NEXUS_WEB_ORIGIN: 'https://console.example.test',
  NEXUS_MULTIPLAYER_ORIGIN: 'https://racing.example.test',
  NEXUS_MULTIPLAYER_PRIVATE_HOSTPORT: 'nexus-multiplayer-fixture:10000',
  NEXTAUTH_SECRET: 'fixture-only-'.repeat(8),
  MULTIPLAYER_SECRET: 'fixture-only-'.repeat(8),
  NEXUS_UPLOAD_DIR: '/var/data/uploads',
};

describe('Render deployment', () => {
  it('rejects a live client bundle with insecure, missing or private networking', () => {
    for (const url of [
      'ws://public.example.test',
      'wss://localhost:10000',
      'wss://127.0.0.1:10000',
      'wss://nexus-multiplayer:10000',
      'wss://game.railway.internal',
      'wss://game.example.test/path',
    ])
      expect(() => buildEnvironment({ ...base, NEXT_PUBLIC_MULTIPLAYER_URL: url })).toThrow();
    expect(() => buildEnvironment({ ...base, NEXUS_MULTIPLAYER_ORIGIN: undefined })).toThrow();
    expect(buildEnvironment(base).NEXT_PUBLIC_MULTIPLAYER_URL).toBe('wss://racing.example.test');
  });
  it('uses preparation until live deployment is explicitly enabled', () => {
    expect(isPreparation({ NEXUS_DEPLOYMENT: 'render' })).toBe(true);
    expect(isPreparation({ ...base, NEXUS_LIVE: 'true' })).toBe(true);
    expect(isPreparation(base)).toBe(false);
    expect(isPreparation({ NEXUS_DEPLOYMENT: 'railway' })).toBe(false);
  });
  it('derives WSS and private control URLs without inventing a public domain', () => {
    const env = deploymentEnvironment(base);
    expect(env.NEXTAUTH_URL).toBe(base.NEXUS_WEB_ORIGIN);
    expect(env.NEXT_PUBLIC_MULTIPLAYER_URL).toBe('wss://racing.example.test');
    expect(env.MULTIPLAYER_INTERNAL_URL).toBe('http://nexus-multiplayer-fixture:10000');
    expect(() => validateProductionConfig(env, 'web')).not.toThrow();
    expect(base.NEXT_PUBLIC_MULTIPLAYER_URL).toBeUndefined();
  });
  it('uses the host-provided web URL as fallback and preserves explicit settings', () => {
    const env = deploymentEnvironment({
      ...base,
      NEXUS_WEB_ORIGIN: undefined,
      RENDER_EXTERNAL_URL: 'https://assigned.example.test',
    });
    expect(env.NEXTAUTH_URL).toBe('https://assigned.example.test');
    expect(
      deploymentEnvironment({ ...base, NEXTAUTH_URL: 'https://custom.example.test' }).NEXTAUTH_URL,
    ).toBe('https://custom.example.test');
  });
  it.each([
    { DATABASE_URL: 'postgresql://fixture@dpg-fixture.frankfurt-postgres.render.com/nexus' },
    { MULTIPLAYER_INTERNAL_URL: 'http://public.example.test' },
    { MULTIPLAYER_INTERNAL_URL: 'http://localhost:10000' },
    { NEXUS_UPLOAD_DIR: '/tmp/uploads' },
    { NEXUS_UPLOAD_DIR: '/var/data/../tmp/uploads' },
    { RENDER: undefined },
  ])('rejects external database/control connections or ephemeral storage %j', (change) => {
    expect(() =>
      validateProductionConfig({ ...deploymentEnvironment(base), ...change }, 'web'),
    ).toThrow();
  });
  it('rejects insecure or path-bearing public origins before a build', () => {
    for (const origin of [
      'http://game.example.test',
      'https://game.example.test/path',
      'https://user:fixture@game.example.test',
      'invalid',
    ])
      expect(() => deploymentEnvironment({ ...base, NEXUS_MULTIPLAYER_ORIGIN: origin })).toThrow();
  });
  it('allows a release container without the runtime disk', () => {
    expect(() =>
      validateProductionConfig(
        { ...deploymentEnvironment(base), NEXUS_UPLOAD_DIR: undefined },
        'web',
        { volume: false },
      ),
    ).not.toThrow();
  });
  it('checks the kernel mount table instead of trusting a directory name', () => {
    expect(hasMount('10 1 0:1 / / rw - overlay overlay rw\n', '/var/data')).toBe(false);
    expect(hasMount('10 1 0:1 / /var/data rw - ext4 /dev/test rw\n', '/var/data')).toBe(true);
    expect(hasMount('10 1 0:1 / /var/data-other rw - ext4 /dev/test rw\n', '/var/data')).toBe(
      false,
    );
  });
  it('declares persistent paid services, private database access and CI gating', () => {
    const blueprint = parse(readFileSync('render.yaml', 'utf8'));
    expect(blueprint.services).toHaveLength(2);
    expect(blueprint.databases).toHaveLength(1);
    expect(blueprint.databases[0].ipAllowList).toEqual([]);
    expect(blueprint.databases[0].postgresMajorVersion).toBe('16');
    expect(blueprint.databases[0].plan).not.toBe('free');
    for (const s of blueprint.services) {
      expect(s.runtime).toBe('docker');
      expect(s.plan).not.toBe('free');
      expect(s.region).toBe('frankfurt');
      expect(s.autoDeployTrigger).toBe('checksPass');
      expect(s.numInstances).toBe(1);
      // Render rejects a custom shutdown delay on disk-backed services.
      if (s.disk) expect(s).not.toHaveProperty('maxShutdownDelaySeconds');
      expect(s.envVars.find((v) => v.key === 'DATABASE_URL').fromDatabase.property).toBe(
        'connectionString',
      );
    }
    expect(blueprint.services.find((s) => s.name === 'nexus-web').disk.mountPath).toBe('/var/data');
    expect(JSON.stringify(blueprint)).not.toContain('NEXUS_LIVE');
  });
  it('starts preparation without a database, rejects registration, and handles SIGTERM', async () => {
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const child = spawn(process.execPath, ['scripts/start-production.mjs', 'web'], {
      env: {
        ...process.env,
        NEXUS_DEPLOYMENT: 'render',
        NEXUS_LIVE: '',
        PORT: String(port),
        DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/unreachable',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Preparation server did not start')), 5000);
        child.stdout.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('error', reject);
      });
      // The mode log is emitted before the asynchronous TCP bind completes.
      await expect
        .poll(async () => {
          try {
            return (await fetch(`http://127.0.0.1:${port}/api/health`)).status;
          } catch {
            return 0;
          }
        })
        .toBe(200);
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      expect((await health.json()).preparation).toBe(true);
      expect(
        (await fetch(`http://127.0.0.1:${port}/api/register`, { method: 'POST' })).status,
      ).toBe(503);
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503);
    } finally {
      child.kill('SIGTERM');
    }
    expect((await exited)[0]).toBe(0);
  });
  it('preparation release does not connect to or migrate a database', async () => {
    const child = spawn(process.execPath, ['scripts/release.mjs'], {
      env: {
        ...process.env,
        NEXUS_DEPLOYMENT: 'render',
        NEXUS_LIVE: '',
        DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/unreachable',
      },
      stdio: 'ignore',
    });
    expect((await once(child, 'exit'))[0]).toBe(0);
  });
});
