import { spawn, execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, writeFile, stat, access, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const output = process.argv[2];
if (!output || !path.isAbsolute(output) || !path.relative(process.cwd(), output).startsWith('..'))
  throw Error('Provide an absolute backup directory OUTSIDE the Git checkout');
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const folder = await mkdtemp(path.join(output, 'nexus-'));
const container = execFileSync('docker', ['compose', 'ps', '-q', 'db'], {
  encoding: 'utf8',
}).trim();
if (!container) throw Error('Local PostgreSQL container must be running');
const run = (command, args, stdio = 'ignore') =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio });
    child.on('error', () => reject(Error('Backup command unavailable')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Backup command failed'))));
  });
const dump = path.join(folder, 'database.dump');
const file = await open(dump, 'wx', 0o600);
try {
  await run(
    'docker',
    ['exec', container, 'pg_dump', '-U', 'nexus', '-d', 'nexus', '-Fc', '--no-owner', '--no-acl'],
    ['ignore', file.fd, 'ignore'],
  );
} finally {
  await file.close();
}
// pg_restore validates the custom archive before the backup is reported as created.
await new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'pg_restore', '--list'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  createReadStream(dump).pipe(child.stdin);
  child.on('error', () => reject(Error('Backup validation unavailable')));
  child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Invalid PostgreSQL backup'))));
});
const uploads = process.env.NEXUS_UPLOAD_DIR ?? path.join(process.cwd(), 'storage/uploads');
await mkdir(uploads, { recursive: true });
await access(uploads);
const archive = path.join(folder, 'uploads.tar.gz');
await run('tar', ['-czf', archive, '-C', uploads, '.']);
await chmod(archive, 0o600);
const artifacts = [];
for (const target of [dump, archive]) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  artifacts.push({
    file: path.basename(target),
    bytes: (await stat(target)).size,
    sha256: hash.digest('hex'),
  });
}
await writeFile(
  path.join(folder, 'manifest.json'),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      format: 'PostgreSQL custom archive + uploads tar',
      artifacts,
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(`Private backup created outside Git: ${folder}`);
