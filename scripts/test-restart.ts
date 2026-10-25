import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, type Room } from '@colyseus/sdk';
import { hashPassword } from '../src/lib/password';
import { signConnectionToken } from '../server/token';
import type { RoomSnapshot } from '../src/multiplayer/contracts';
const name = `nexus_restart_${randomBytes(5).toString('hex')}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = `/${name}`;
const env = {
  ...process.env,
  DATABASE_URL: url.href,
  GAME_PORT: '2568',
  GAME_HOST: '127.0.0.1',
  NEXT_PUBLIC_MULTIPLAYER_URL: 'ws://localhost:2568',
};
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
let processHandle: ChildProcess | null = null;
const rooms: Room[] = [];
async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 12000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error('Restart probe timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
}
async function command(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn('npm', args, { env, stdio: 'pipe' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(Error(`Setup failed: ${args[1]}`))));
  });
}
async function start() {
  processHandle = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env,
    stdio: 'pipe',
  });
  await waitFor(async () => {
    try {
      return (await fetch('http://127.0.0.1:2568/health', { signal: AbortSignal.timeout(500) })).ok;
    } catch {
      return false;
    }
  });
}
async function stop(signal: NodeJS.Signals) {
  const p = processHandle;
  processHandle = null;
  if (p)
    await new Promise<void>((resolve) => {
      if (p.exitCode !== null) resolve();
      else {
        p.once('exit', () => resolve());
        p.kill(signal);
      }
    });
}
async function control(userId: string, body: Record<string, unknown>) {
  const res = await fetch('http://127.0.0.1:2568/control', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signConnectionToken({ sub: userId, ver: 0, kind: 'control' })}`,
    },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  return res.json();
}
try {
  assert(/^nexus_restart_[a-f0-9]{10}$/.test(name));
  await admin.query(`CREATE DATABASE ${name}`);
  await command(['run', 'db:migrate']);
  await command(['run', 'db:seed']);
  const hash = await hashPassword('Nexus isolated restart probe password');
  const users = await Promise.all(
    [0, 1].map((i) =>
      prisma.user.create({
        data: { username: `restart_${i}`, email: `restart_${i}@example.test`, passwordHash: hash },
      }),
    ),
  );
  const game = await prisma.game.findUniqueOrThrow({ where: { slug: 'midnight-outlaws' } });
  await prisma.userLibrary.createMany({
    data: users.map((u) => ({ userId: u.id, gameId: game.id })),
  });
  await start();
  const first = await control(users[0].id, {
    action: 'create',
    gameId: game.id,
    private: false,
    maxPlayers: 2,
  });
  const a = await new Client('ws://localhost:2568').consumeSeatReservation(first.reservation);
  rooms.push(a);
  a.reconnection.enabled = false;
  let state: RoomSnapshot | null = null;
  a.onMessage('snapshot', (s: RoomSnapshot) => {
    state = s;
  });
  a.onMessage('event', () => {});
  a.onMessage('notice', () => {});
  const second = await control(users[1].id, { action: 'join', gameId: game.id, roomId: a.roomId });
  const b = await new Client('ws://localhost:2568').consumeSeatReservation(second.reservation);
  rooms.push(b);
  b.reconnection.enabled = false;
  b.onMessage('snapshot', () => {});
  b.onMessage('event', () => {});
  await waitFor(() => state?.players.length === 2);
  a.send('ready', true);
  b.send('ready', true);
  await waitFor(() => state?.players.every((p) => p.ready) === true);
  a.send('start');
  await waitFor(() => state?.phase === 'racing');
  const match = await prisma.multiplayerMatch.findFirstOrThrow();
  assert.equal(match.status, 'RACING');
  await stop('SIGKILL');
  await start();
  const restored = await prisma.multiplayerMatch.findUniqueOrThrow({
    where: { id: match.id },
    include: { participants: { include: { result: true } } },
  });
  assert.equal(restored.status, 'ABORTED');
  assert(restored.endedAt);
  assert(restored.participants.every((p) => p.result === null));
  await assert.rejects(new Client('ws://localhost:2568').joinById(a.roomId, {}));
  const report = {
    date: new Date().toISOString(),
    checks: [
      'Real separate Colyseus process killed during a two-account race',
      'Restart marks unfinished durable match ABORTED',
      'No fabricated winner or result row',
      'Lost in-memory room cannot be joined after restart',
    ],
    isolatedDatabase: true,
  };
  await writeFile('docs/multiplayer-restart-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.allSettled(rooms.filter((r) => r.connection.isOpen).map((r) => r.leave()));
  await stop('SIGTERM');
  await prisma.$disconnect();
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}
