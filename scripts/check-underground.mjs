import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const revision = '327b22c39041f197a4cfdf2544f81799b332b6c7';
const root = 'public/nfsu-runtime';
const manifest = JSON.parse(await fs.readFile(root + '/manifest.json', 'utf8'));
if (manifest.upstreamRevision !== revision || manifest.containsOriginalGameContent !== false)
  throw Error('Unexpected runtime distribution manifest');
const expected = new Map(manifest.resources.map((r) => [r.path, r]));
const required = [
  'runtime.js',
  'index.html',
  'runtime.css',
  'host/io-worker.js',
  'host/game-worker.js',
  'gpu/png-worker.js',
  'audio/worklet.js',
  'LICENSE.txt',
  'prepare-underground.mjs',
];
for (const file of required)
  if (!expected.has(file)) throw Error('Missing browser host component: ' + file);
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('No symlinks in runtime distribution');
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (rel === 'manifest.json') continue;
      const record = expected.get(rel);
      if (!record || !/\.(js|mjs|html|css|txt)$/.test(rel))
        throw Error('Unreviewed or protected artifact: ' + rel);
      const bytes = await fs.readFile(file);
      if (
        bytes.length !== record.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== record.sha256
      )
        throw Error('Stale or changed runtime bundle: ' + rel);
      expected.delete(rel);
    }
  }
}
await walk(root);
if (expected.size) throw Error('Missing runtime resource');
const notices = await fs.readFile(root + '/LICENSE.txt', 'utf8');
for (const author of [
  'Luis Guilherme Lellis Vieira',
  'th0mk',
  'Talha Müderrisoğlu',
  'Paul Miller',
  'Colin McDonnell',
])
  if (!notices.includes(author)) throw Error('Missing copyright notice: ' + author);
const upstream = JSON.parse(await fs.readFile('vendor/nfsu1-web/UPSTREAM.json', 'utf8'));
if (upstream.commit !== revision) throw Error('Vendor revision drift');
const patches = new Set([
  'src/app/game.ts',
  'src/host/process.ts',
  'src/host/proto.ts',
  'src/host/io-worker.ts',
  'src/gpu/index.ts',
  'src/audio/index.ts',
  'src/input/gamepad.ts',
]);
for (const item of upstream.originalFiles) {
  const hash = createHash('sha256')
    .update(await fs.readFile('vendor/nfsu1-web/' + item.path))
    .digest('hex');
  if (hash !== item.sha256 && !patches.has(item.path))
    throw Error('Review upstream source change: ' + item.path);
}
console.log(
  JSON.stringify({
    stage: 'A',
    openBrowserResources: manifest.resources.length,
    originalGameContentDistributed: false,
    gameplayTested: false,
  }),
);
