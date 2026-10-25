import { describe, it, expect } from 'vitest';
import { validateProductionConfig } from '../scripts/production-config.mjs';
import program from '../.railway/railway.ts';
import { createRailwayContext, project, validateGraph } from 'railway/iac';

const settings = {
  NODE_ENV: 'production',
  NEXUS_DEPLOYMENT: 'railway',
  PORT: '3000',
  DATABASE_URL: 'postgresql://nexus:fixture-only@db.railway.internal:5432/nexus',
  NEXTAUTH_URL: 'https://console.example.test',
  NEXT_PUBLIC_MULTIPLAYER_URL: 'wss://game.example.test',
  NEXTAUTH_SECRET: 'fixture-only-'.repeat(8),
  MULTIPLAYER_SECRET: 'fixture-only-'.repeat(8),
  MULTIPLAYER_INTERNAL_URL: 'http://game.railway.internal:2567',
  RAILWAY_VOLUME_MOUNT_PATH: '/data',
  NEXUS_UPLOAD_DIR: '/data/uploads',
};
describe('production deployment boundaries', () => {
  it('accepts private database and mounted storage', () =>
    expect(() => validateProductionConfig(settings, 'web')).not.toThrow());
  it('allows a release container without a mounted volume', () =>
    expect(() =>
      validateProductionConfig({ ...settings, RAILWAY_VOLUME_MOUNT_PATH: undefined }, 'web', {
        volume: false,
      }),
    ).not.toThrow());
  it.each([
    { NEXTAUTH_URL: 'http://console.example.test' },
    { NEXTAUTH_URL: 'https://localhost' },
    { NEXT_PUBLIC_MULTIPLAYER_URL: 'ws://game.example.test' },
    { NEXT_PUBLIC_MULTIPLAYER_URL: 'wss://game.example.test/path' },
    { DATABASE_URL: 'postgresql://fixture-only@public.example.test/nexus' },
    { MULTIPLAYER_INTERNAL_URL: 'http://public.example.test' },
    { RAILWAY_VOLUME_MOUNT_PATH: undefined },
    { NEXUS_UPLOAD_DIR: '/tmp/uploads' },
    { NEXUS_UPLOAD_DIR: '/data/../tmp/uploads' },
    { PORT: '70000' },
    { NEXTAUTH_SECRET: 'short-fixture' },
  ])('rejects unsafe configuration %j', (change) =>
    expect(() => validateProductionConfig({ ...settings, ...change }, 'web')).toThrow(),
  );
  it('does not expose secret contents in a validation failure', () => {
    const secret = 'do-not-log-this-fixture';
    try {
      validateProductionConfig({ ...settings, NEXTAUTH_SECRET: secret }, 'web');
    } catch (error) {
      expect(error.message).not.toContain(secret);
      return;
    }
    throw Error('Expected validation error');
  });
  it('defines three services, private PostgreSQL, persistent volumes and CI gates', async () => {
    const config = await program(createRailwayContext({ environment: 'production' }), project);
    const services = config.resources.filter((r) => r.type === 'service');
    expect(services).toHaveLength(3);
    const db = services.find((r) => r.name === 'NEXUS Database');
    expect(db.source.image).toBe('postgres:16-alpine');
    expect(db.networking.tcpProxies).toEqual({});
    expect(db.networking.serviceDomains).toEqual({});
    expect(config.resources.filter((r) => r.type === 'volume')).toHaveLength(2);
    for (const s of services.filter((r) => r.name !== 'NEXUS Database')) {
      expect(s.source.checkSuites).toBe(true);
      expect(s.deploy.numReplicas).toBe(1);
      expect(s.deploy.sleepApplication).toBe(false);
      expect(s.deploy.preDeployCommand).toEqual(['node scripts/release.mjs']);
    }
    expect(
      validateGraph({
        version: 1,
        project: { name: config.name },
        environments: [],
        resources: config.resources,
        edges: [],
      }),
    ).toEqual([]);
  });
});
