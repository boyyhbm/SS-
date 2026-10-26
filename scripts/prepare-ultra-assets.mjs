// Optional Ultra/Cinematic native-detail pack. No texture is upscaled. External
// glTF resources keep each immutable file within Git/hosting size budgets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO, Format } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt, prune, dedup, unpartition, listTextureSlots } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { assembleBistro } from './build-bistro.mjs';
import { encodeAssetTexture } from './asset-textures.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
await MeshoptEncoder.ready;
const { combined: doc } = await assembleBistro();
for (const t of doc.getRoot().listTextures()) {
  const space = listTextureSlots(t).some((s) =>
    /baseColor|emissive|sheenColor|specularColor/i.test(s),
  )
    ? 'srgb'
    : 'linear';
  const b = await encodeAssetTexture(
    Buffer.from(t.getImage()),
    2048,
    space,
    'ktx2',
    space === 'srgb',
  );
  t.setImage(b)
    .setMimeType('image/ktx2')
    .setURI('texture-' + hash(b).slice(0, 10) + '.ktx2');
}
doc.createExtension(KHRTextureBasisu).setRequired(true);
await doc.transform(
  dedup(),
  meshopt({ encoder: MeshoptEncoder, level: 'high', quantizeNormal: 12 }),
  prune(),
  unpartition(),
);
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder }),
  result = await io.writeJSON(doc, { format: Format.GLTF, basename: 'district' });
const raw = Buffer.from(JSON.stringify(result.json)),
  fingerprint = hash(
    Buffer.concat([
      raw,
      ...Object.entries(result.resources)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, b]) => Buffer.from(name + hash(b))),
    ]),
  );
const dir = 'district-ultra-' + fingerprint.slice(0, 10),
  out = 'public/game-assets/' + dir;
await fs.mkdir(out, { recursive: true });
const products = [];
for (const [name, bytes] of Object.entries({ ...result.resources, 'district.gltf': raw })) {
  if (path.basename(name) !== name || bytes.length > 95 * 1024 * 1024)
    throw Error('Resource exceeds reviewed pack budget');
  await fs.writeFile(out + '/' + name, bytes);
  products.push({
    filename: dir + '/' + name,
    bytes: bytes.length,
    sha256: hash(bytes),
    textureMaximum: 2048,
  });
}
const manifestPath = 'public/game-assets/graphics-manifest.json',
  manifest = JSON.parse(await fs.readFile(manifestPath));
manifest.district.ultra = {
  ktx2: '/game-assets/' + dir + '/district.gltf',
  fallback: manifest.district.high.fallback,
};
manifest.products = manifest.products
  .filter((p) => !p.filename.startsWith('district-ultra-'))
  .concat(products);
manifest.notes.push(
  'Ultra/Cinematic: full source district geometry, native maps up to 2048, 12-bit normals; external immutable glTF pack. WebP fallback deliberately uses the High pack.',
);
await fs.writeFile(manifestPath + '.next', JSON.stringify(manifest, null, 2) + '\n');
await fs.rename(manifestPath + '.next', manifestPath);
console.log(
  JSON.stringify({
    pack: dir,
    files: products.length,
    bytes: products.reduce((s, p) => s + p.bytes, 0),
  }),
);
