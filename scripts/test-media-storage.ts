import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import {
  readUploadedImage,
  saveUploadedImage,
  storeDatabaseImages,
  uploadedImageExists,
} from '../src/lib/uploads';
import { GET } from '../src/app/api/media/[file]/route';

// Mutations are restricted to explicit, disposable loopback QA databases. This
// script must never be used as a production health check.
const target = new URL(process.env.DATABASE_URL!);
if (
  process.env.NEXUS_E2E_DISPOSABLE_DB !== '1' ||
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  process.env.NEXUS_MEDIA_STORE !== 'database'
)
  throw Error('A disposable local database and database media mode are required');

const files = Array.from({ length: 8 }, () => `${randomUUID()}.webp`);
const directory = await mkdtemp(path.join(os.tmpdir(), 'nexus-media-qa-'));
const manifest = path.join(directory, 'manifest.json');
const uploads = path.join(directory, 'uploads');
const { mkdir } = await import('node:fs/promises');
await mkdir(uploads);
const originalQuota = process.env.NEXUS_MEDIA_LIMIT_BYTES;
const checks: string[] = [];
async function importer(apply = false) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/import-media.ts',
        '--directory',
        uploads,
        '--manifest',
        manifest,
        ...(apply ? ['--apply'] : []),
      ],
      {
        env: { ...process.env, NEXUS_MIGRATION_HOLD: '1' },
        stdio: 'ignore',
      },
    );
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
try {
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#334866' },
  })
    .webp()
    .toBuffer();
  const changed = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#ff9759' },
  })
    .webp()
    .toBuffer();
  await saveUploadedImage(files[0], image);
  assert(await uploadedImageExists(files[0]));
  assert.deepEqual(Buffer.from((await readUploadedImage(files[0]))!), image);
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ file: files[0] }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert(response.headers.get('cache-control')?.includes('immutable'));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  checks.push('Database bytea roundtrip and unchanged immutable public media response');
  assert.equal((await storeDatabaseImages([{ file: files[0], content: image }])).imported, 0);
  await assert.rejects(
    storeDatabaseImages([
      { file: files[1], content: image },
      { file: files[0], content: changed },
    ]),
  );
  assert.equal(await uploadedImageExists(files[1]), false);
  checks.push('Idempotent import; conflicting immutable URL rolls back the entire batch');

  const used = (await db.uploadedImage.aggregate({ _sum: { size: true } }))._sum.size!;
  process.env.NEXUS_MEDIA_LIMIT_BYTES = String(used + image.length);
  const races = await Promise.allSettled([
    saveUploadedImage(files[2], image),
    saveUploadedImage(files[3], image),
  ]);
  assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await db.uploadedImage.aggregate({ _sum: { size: true } }))._sum.size,
    used + image.length,
  );
  await assert.rejects(
    storeDatabaseImages([
      { file: files[4], content: image },
      { file: files[5], content: image },
    ]),
  );
  assert.equal(await uploadedImageExists(files[4]), false);
  checks.push(
    'Concurrent uploads serialize their quota; over-quota batches leave no partial files',
  );

  process.env.NEXUS_MEDIA_LIMIT_BYTES = originalQuota;
  await writeFile(path.join(uploads, files[6]), image);
  assert.equal(await importer(), 0);
  assert.equal(await uploadedImageExists(files[6]), false);
  assert.equal(await importer(true), 0);
  assert.equal(await importer(true), 0);
  assert.deepEqual(Buffer.from((await readUploadedImage(files[6]))!), image);
  await writeFile(path.join(uploads, files[6]), changed);
  assert.notEqual(await importer(true), 0);
  assert.deepEqual(Buffer.from((await readUploadedImage(files[6]))!), image);
  checks.push(
    'Real CLI preflight makes no database writes; verified import is repeatable and rejects changed backups',
  );
  const payload = JSON.parse(await readFile(manifest, 'utf8'));
  assert.equal(payload.images.length, 1);
  console.log(
    JSON.stringify(
      { passed: true, scope: 'Isolated local PostgreSQL, not Northflank production', checks },
      null,
      2,
    ),
  );
} finally {
  process.env.NEXUS_MEDIA_LIMIT_BYTES = originalQuota;
  await db.uploadedImage.deleteMany({ where: { file: { in: files } } });
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
