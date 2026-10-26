import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { REVISION } from 'three';
const root = path.resolve('public/game-assets'),
  manifest = JSON.parse(await fs.readFile(root + '/graphics-manifest.json'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(REVISION, '186', 'Regenerate and version the decoder when upgrading Three');
const known = new Map(manifest.products.map((p) => [p.filename, p]));
let total = 0;
for (const p of manifest.products) {
  const file = path.resolve(root, p.filename);
  assert(file.startsWith(root + path.sep));
  const bytes = await fs.readFile(file);
  assert.equal(bytes.length, p.bytes, p.filename);
  assert.equal(hash(bytes), p.sha256, p.filename);
  assert(bytes.length < 95 * 1024 * 1024, p.filename + ' exceeds per-file budget');
  total += bytes.length;
  if (p.filename.endsWith('.gltf')) {
    const gltf = JSON.parse(bytes);
    for (const item of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!item.uri) {
        assert(
          item.extensions?.EXT_meshopt_compression?.fallback === true ||
            (Number.isInteger(item.bufferView) && item.mimeType === 'image/ktx2'),
        );
        continue;
      }
      assert(!item.uri.includes(':') && !item.uri.startsWith('/'));
      const resolved = path
        .relative(root, path.resolve(path.dirname(file), item.uri))
        .replaceAll(path.sep, '/');
      assert(known.has(resolved), 'Unmanifested external resource ' + resolved);
    }
  }
}
const worker = await fs.readFile(path.resolve('public', '.' + manifest.basisWorker));
assert(manifest.basisWorker.includes(hash(worker).slice(0, 10)));
for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm'])
  assert.equal(
    hash(await fs.readFile(root + '/basis-r186/' + file)),
    hash(await fs.readFile('node_modules/three/examples/jsm/libs/basis/' + file)),
  );
for (const file of ['LICENSE', 'THREE-LICENSE'])
  assert((await fs.stat(root + '/basis-r186/' + file)).size > 100);
for (const source of manifest.sources) {
  assert(['CC-BY-4.0', 'CC0-1.0'].includes(source.license));
  assert.equal(source.commercialUsePermitted, true);
  assert(source.author && source.url);
}
// Every new, pinned CC0 pack is independently hashed and shipped with its license.
for (const filename of ['vehicle-manifest.json', 'track-manifest.json']) {
  const pack = JSON.parse(await fs.readFile(root + '/' + filename));
  assert.equal(pack.license, 'CC0-1.0');
  assert.equal(pack.commercialUse, true);
  assert(pack.author && pack.mirror);
  const licenses = pack.licenseFile
    ? [pack.licenseFile]
    : Object.values(pack.packs).map((p) => p.licenseFile);
  for (const filename of licenses) {
    const license = await fs.readFile(path.resolve('public', '.' + filename), 'utf8');
    assert(/Creative Commons Zero|CC0/.test(license));
    assert(/commercial (purposes|projects)/i.test(license));
  }
  for (const model of Object.values(pack.models)) {
    const file = path.resolve('public', '.' + model.path);
    assert(file.startsWith(root + path.sep));
    const bytes = await fs.readFile(file);
    assert.equal(bytes.length, model.bytes);
    assert.equal(hash(bytes), model.sha256);
    if (model.pack === 'nature') {
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      for (const material of gltf.materials ?? []) {
        assert.equal(
          material.pbrMetallicRoughness?.metallicFactor,
          0,
          'Nature material must explicitly be dielectric',
        );
        assert((material.pbrMetallicRoughness?.roughnessFactor ?? 1) >= 0.85);
      }
    }
    assert(model.path.includes(model.sha256.slice(0, 10)));
    assert(/^[a-f0-9]{64}$/.test(model.sourceSha256));
    assert(
      model.sourceUrl.startsWith(
        'https://raw.githubusercontent.com/leaukojo/carlito/3c098d5612dd545f00c7355bedd1cb6fb6576b9c/',
      ),
    );
  }
}
console.log(
  JSON.stringify({
    passed: true,
    resources: manifest.products.length,
    totalBytes: total,
    decoderRevision: REVISION,
  }),
);
