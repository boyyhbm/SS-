import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const out = 'public/nfsu-runtime';
await fs.mkdir(out, { recursive: true });
const license = await fs.readFile('vendor/nfsu1-web/LICENSE', 'utf8');
const bundle = await build({
  entryPoints: {
    runtime: 'integrations/underground/runtime.ts',
    'host/game-worker': 'vendor/nfsu1-web/src/host/game-worker.ts',
    'host/io-worker': 'vendor/nfsu1-web/src/host/io-worker.ts',
    'gpu/png-worker': 'vendor/nfsu1-web/src/gpu/png-worker.ts',
    'audio/worklet': 'vendor/nfsu1-web/src/audio/worklet.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome140'],
  outdir: out,
  minify: true,
  loader: { '.txt': 'text' },
  legalComments: 'eof',
  metafile: true,
  banner: {
    js: '/*! NEXUS Underground local-only adapter. nfsu1-web MIT: see /nfsu/LICENSE.txt. No EA game code or resources included. */',
  },
});
for (const input of Object.keys(bundle.metafile.inputs)) {
  if (
    !/^(?:integrations\/underground\/|vendor\/nfsu1-web\/(?:src\/|registry-defaults\.txt$)|src\/games\/underground\/contracts\.ts$|src\/input\/profiles\.ts$|node_modules\/(?:zod\/|@noble\/hashes\/))/.test(
      input,
    )
  )
    throw Error('Review the license of the new browser dependency before bundling: ' + input);
}
for (const name of ['index.html', 'runtime.css'])
  await fs.copyFile('integrations/underground/' + name, out + '/' + name);
await fs.writeFile(
  out + '/LICENSE.txt',
  license +
    '\n\n--- @noble/hashes 2.0.1 ---\n' +
    (await fs.readFile('node_modules/@noble/hashes/LICENSE', 'utf8')) +
    '\n\n--- zod 4.6.7 ---\n' +
    (await fs.readFile('node_modules/zod/LICENSE', 'utf8')),
);
await fs.copyFile('scripts/prepare-underground.mjs', out + '/prepare-underground.mjs');
const resources = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const rel = path.relative(out, file).split(path.sep).join('/');
      if (rel === 'manifest.json') continue;
      if (!/\.(?:js|mjs|html|css|txt)$/.test(rel))
        throw Error('Forbidden runtime distribution artifact: ' + rel);
      const bytes = await fs.readFile(file);
      resources.push({
        path: rel,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
await walk(out);
await fs.writeFile(
  out + '/manifest.json',
  JSON.stringify(
    {
      format: 'nexus-nfsu-tools/v1',
      upstreamRevision: '327b22c39041f197a4cfdf2544f81799b332b6c7',
      containsOriginalGameContent: false,
      resources,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ bundledOpenRuntime: true, resources: resources.length }));
