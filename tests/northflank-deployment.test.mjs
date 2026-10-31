import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  buildEnvironment,
  deploymentEnvironment,
  isMigrationHold,
  isPreparation,
} from '../scripts/deployment-env.mjs';
import { validateProductionConfig } from '../scripts/production-config.mjs';

const base = {
  NODE_ENV: 'production',
  NEXUS_DEPLOYMENT: 'northflank',
  NF_PROJECT_ID: 'nexus',
  NF_OBJECT_ID: 'nexus-web',
  NEXUS_MIGRATION_HOLD: '0',
  NEXUS_MEDIA_STORE: 'database',
  NEXUS_MEDIA_LIMIT_BYTES: '52428800',
  PORT: '3000',
  NEXUS_WEB_ORIGIN: 'https://web.example.test',
  NEXUS_MULTIPLAYER_ORIGIN: 'https://mp.example.test',
  NEXUS_MULTIPLAYER_PRIVATE_HOSTPORT: 'nexus-multiplayer:2567',
  DATABASE_URL: 'postgresql://fixture:fixture-only@nexus-database:5432/nexus',
  NEXTAUTH_SECRET: 'fixture-only-'.repeat(8),
  MULTIPLAYER_SECRET: 'fixture-only-'.repeat(8),
};

describe('Northflank migration', () => {
  it('uses assigned origins and private networking without requiring a volume', () => {
    const env = deploymentEnvironment(base);
    expect(env.NEXTAUTH_URL).toBe(base.NEXUS_WEB_ORIGIN);
    expect(env.NEXT_PUBLIC_MULTIPLAYER_URL).toBe('wss://mp.example.test');
    expect(env.MULTIPLAYER_INTERNAL_URL).toBe('http://nexus-multiplayer:2567');
    expect(() => validateProductionConfig(env, 'web')).not.toThrow();
    expect(() => validateProductionConfig(env, 'multiplayer')).not.toThrow();
  });
  it.each([
    { NF_PROJECT_ID: '' },
    { NF_OBJECT_ID: '' },
    { NEXUS_MIGRATION_HOLD: undefined },
    { NEXUS_MIGRATION_HOLD: 'true' },
    { NEXUS_MEDIA_STORE: 'filesystem' },
    { NEXUS_MEDIA_STORE: 'databse' },
    { NEXUS_MEDIA_LIMIT_BYTES: '0' },
    { NEXUS_MEDIA_LIMIT_BYTES: '50 MB' },
    { DATABASE_URL: 'postgres://fixture@db.example.test/nexus' },
    { DATABASE_URL: 'postgres://fixture@localhost/nexus' },
    { MULTIPLAYER_INTERNAL_URL: 'http://mp.example.test' },
    { MULTIPLAYER_INTERNAL_URL: 'http://nexus-multiplayer/admin' },
  ])('refuses an unsafe destination %j', (change) => {
    expect(() =>
      validateProductionConfig({ ...deploymentEnvironment(base), ...change }, 'web'),
    ).toThrow();
  });
  it('builds the complete application during migration hold', () => {
    const env = { ...base, NEXUS_MIGRATION_HOLD: '1' };
    expect(isMigrationHold(env)).toBe(true);
    expect(isPreparation(env)).toBe(false);
    expect(buildEnvironment(env).NEXT_PUBLIC_MULTIPLAYER_URL).toBe('wss://mp.example.test');
    expect(() =>
      buildEnvironment({ ...env, NEXT_PUBLIC_MULTIPLAYER_URL: 'ws://mp.example.test' }),
    ).toThrow();
  });
  it.each(['web', 'multiplayer'])('holds %s without touching the database', async (service) => {
    const socket = createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const child = spawn(process.execPath, ['scripts/start-production.mjs', service], {
      env: {
        ...process.env,
        NEXUS_DEPLOYMENT: 'northflank',
        NEXUS_MIGRATION_HOLD: '1',
        PORT: String(port),
        DATABASE_URL: 'postgres://fixture@127.0.0.1:1/unreachable',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    try {
      await expect
        .poll(async () => {
          try {
            return (await fetch(`http://127.0.0.1:${port}/live`)).status;
          } catch {
            return 0;
          }
        })
        .toBe(200);
      expect((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).preparation).toBe(
        true,
      );
      for (const endpoint of ['/api/register', '/control', '/nfsu/'])
        expect((await fetch(`http://127.0.0.1:${port}${endpoint}`)).status).toBe(503);
    } finally {
      child.kill('SIGTERM');
    }
    expect((await exited)[0]).toBe(0);
  });
  it('skips release database access while the destination is held', async () => {
    const child = spawn(process.execPath, ['scripts/release.mjs'], {
      env: {
        ...process.env,
        NEXUS_DEPLOYMENT: 'northflank',
        NEXUS_MIGRATION_HOLD: '1',
        DATABASE_URL: 'postgres://fixture@127.0.0.1:1/unreachable',
      },
      stdio: 'ignore',
    });
    expect((await once(child, 'exit'))[0]).toBe(0);
  });
});
