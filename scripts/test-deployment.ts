import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const backup = process.argv[2];
if (!backup || !path.isAbsolute(backup) || !path.relative(process.cwd(), backup).startsWith('..'))
  throw Error('Provide a private database.dump outside the checkout');
const source = new URL(process.env.DATABASE_URL!);
if (!['localhost', '127.0.0.1'].includes(source.hostname))
  throw Error('Local deployment rehearsal only');
const name = `nexus_deploy_qa_${randomBytes(6).toString('hex')}`;
const target = new URL(source);
target.pathname = '/' + name;
const admin = new Client({ connectionString: source.toString() });
const container = execFileSync('docker', ['compose', 'ps', '-q', 'db'], {
  encoding: 'utf8',
}).trim();
const processes: ChildProcess[] = [];
const checks: string[] = [];
let database: PrismaClient | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fingerprints(dbName: string) {
  const client = new Client({
    connectionString: (() => {
      const u = new URL(source);
      u.pathname = '/' + dbName;
      return u.toString();
    })(),
  });
  await client.connect();
  try {
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const result: Record<string, { count: string; digest: string }> = {};
    for (const { tablename } of tables.rows) {
      const table = '"' + tablename.replaceAll('"', '""') + '"';
      const rows = await client.query(
        `SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS digest FROM ${table} t`,
      );
      result[tablename] = rows.rows[0];
    }
    return result;
  } finally {
    await client.end();
  }
}
async function health(port: number, endpoint = '/health') {
  try {
    return await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    return null;
  }
}
async function waitReady(port: number) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if ((await health(port))?.ok) return;
    await pause(200);
  }
  throw Error('Rehearsal server did not become ready');
}
function start(port: number) {
  const child = spawn(process.execPath, ['scripts/start-production.mjs', 'multiplayer'], {
    env: {
      ...process.env,
      DATABASE_URL: target.toString(),
      PORT: String(port),
      GAME_HOST: '0.0.0.0',
      NODE_ENV: 'production',
      NEXUS_DEPLOYMENT: 'local-rehearsal',
      NEXTAUTH_URL: 'https://console.example.test',
      NEXT_PUBLIC_MULTIPLAYER_URL: 'wss://game.example.test',
    },
    stdio: 'ignore',
  });
  processes.push(child);
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 12000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  await new Promise<void>((resolve, reject) => {
    const restore = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'pg_restore',
        '-U',
        'nexus',
        '-d',
        name,
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    createReadStream(backup).pipe(restore.stdin);
    restore.on('error', () => reject(Error('Restore process failed')));
    restore.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Restore failed'))));
  });
  const before = await fingerprints(source.pathname.slice(1));
  const restored = await fingerprints(name);
  assert.deepEqual(restored, before);
  checks.push(
    'Private backup restored; every public table row count and content fingerprint matches',
  );
  await Promise.all(
    ['web', 'multiplayer'].map(
      (service) =>
        new Promise<void>((resolve, reject) => {
          const release = spawn(process.execPath, ['scripts/release.mjs'], {
            env: {
              ...process.env,
              DATABASE_URL: target.toString(),
              NODE_ENV: 'production',
              NEXUS_DEPLOYMENT: 'local-rehearsal',
              NEXUS_SERVICE: service,
              PORT: '3000',
              NEXTAUTH_URL: 'https://console.example.test',
              NEXT_PUBLIC_MULTIPLAYER_URL: 'wss://game.example.test',
              MULTIPLAYER_INTERNAL_URL: 'http://127.0.0.1:2567',
            },
            stdio: 'ignore',
          });
          release.on('error', () => reject(Error('Release rehearsal process failed')));
          release.on('exit', (code) =>
            code === 0 ? resolve() : reject(Error('Release rehearsal failed')),
          );
        }),
    ),
  );
  assert.deepEqual(await fingerprints(name), restored);
  checks.push(
    'Concurrent Web/Multiplayer pre-deploy migrations and idempotent seed preserve restored data',
  );
  database = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
  const first = start(28067);
  await waitReady(28067);
  checks.push('Production launcher binds host PORT and reports database-aware readiness');
  const game = await database.game.findFirstOrThrow({ where: { slug: 'midnight-outlaws' } });
  const user = await database.user.create({
    data: {
      username: `deploy_${randomBytes(5).toString('hex')}`,
      email: `deploy_${randomBytes(5).toString('hex')}@example.test`,
      passwordHash: 'unusable-integration-fixture',
    },
  });
  const match = await database.multiplayerMatch.create({
    data: {
      gameId: game.id,
      roomId: 'ownership-rehearsal',
      mode: 'circuit',
      region: 'europe',
      status: 'RACING',
      startedAt: new Date(),
    },
  });
  const second = start(28068);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(await health(28068, '/live'))?.ok) await pause(100);
  assert.equal((await health(28068, '/live'))?.status, 200);
  assert.equal((await health(28068))?.status, 503);
  assert.equal(
    (await database.multiplayerMatch.findUniqueOrThrow({ where: { id: match.id } })).status,
    'RACING',
  );
  checks.push('Standby is live but not ready; does not abort the active process matches');
  const denied = await fetch('http://127.0.0.1:28067/health', {
    headers: { Origin: 'https://untrusted.example.test' },
  });
  assert.equal(denied.status, 403);
  const unauthorized = await fetch('http://127.0.0.1:28067/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 403);
  checks.push('Untrusted browser origin and unsigned control requests rejected');
  await stop(first);
  await waitReady(28068);
  assert.equal(
    (await database.multiplayerMatch.findUniqueOrThrow({ where: { id: match.id } })).status,
    'ABORTED',
  );
  assert.equal(
    await database.matchResult.count({ where: { participant: { matchId: match.id } } }),
    0,
  );
  checks.push(
    'SIGTERM releases ownership; standby recovers unfinished race without a fabricated result',
  );
  await stop(second);
  await database.multiplayerMatch.delete({ where: { id: match.id } });
  await database.user.delete({ where: { id: user.id } });
  const after = await fingerprints(name);
  for (const table of [
    'User',
    'UserLibrary',
    'UserSettings',
    'ControllerProfile',
    'GameSave',
    'Friendship',
    'MatchResult',
  ])
    assert.deepEqual(after[table], restored[table]);
  checks.push(
    'Accounts, libraries, settings, controller profiles, saves, friends and existing results survive restarts unchanged',
  );
  await writeFile(
    'docs/deployment-local-tests.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scope: 'LOCAL deployment rehearsal, not a public hosting verification',
        passed: true,
        checks,
        tableCount: Object.keys(restored).length,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ passed: true, scope: 'local-only', checks }));
} catch {
  await writeFile(
    'docs/deployment-local-tests.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scope: 'LOCAL deployment rehearsal, not a public hosting verification',
        passed: false,
        completedChecks: checks,
      },
      null,
      2,
    ) + '\n',
  );
  console.error('Local deployment rehearsal failed; production status is unchanged.');
  process.exitCode = 1;
} finally {
  for (const child of processes) await stop(child);
  await database?.$disconnect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
