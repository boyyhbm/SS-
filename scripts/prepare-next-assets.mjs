// Offline build only. Runtime installation never requires KTX tools or downloads.
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTTextureWebP } from '@gltf-transform/extensions';
import {
  mergeDocuments,
  prune,
  dedup,
  weld,
  simplify,
  meshopt,
  listTextureSlots,
  unpartition,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import draco from 'draco3dgltf';
import sharp from 'sharp';
import { encodeAssetTexture as texture } from './asset-textures.mjs';
import { assembleBistro } from './build-bistro.mjs';
const exec = promisify(execFile),
  ktx = process.env.KTX_BIN ?? 'toktx';
const out = 'public/game-assets',
  cache = '.asset-cache/next';
await fs.mkdir(cache, { recursive: true });
await exec(ktx, ['--version']);
if (!(await fs.stat(cache + '/asphalt-color.png').catch(() => null)))
  await exec('python3', ['scripts/convert-road-material.py']);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const old = JSON.parse(await fs.readFile(out + '/manifest.json', 'utf8'));
const carBytes = await fs.readFile('.asset-cache/car.glb');
if (hash(carBytes) !== old.sources.find((x) => x.key === 'car').sha256)
  throw Error('Reviewed car source changed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
  'draco3d.decoder': await draco.createDecoderModule(),
});
const products = [];
async function emit(name, source, size, format) {
  const doc = new Document(),
    mapping = mergeDocuments(doc, source);
  doc.getRoot().setDefaultScene(mapping.get(source.getRoot().getDefaultScene()));
  for (const t of doc.getRoot().listTextures()) {
    const slots = listTextureSlots(t),
      space = slots.some((s) => /baseColor|emissive|sheenColor|specularColor/i.test(s))
        ? 'srgb'
        : 'linear';
    const image = t.getImage();
    if (!image) continue;
    const building = name.startsWith('district');
    const limit = building && space === 'linear' ? Math.min(size, size > 1024 ? 1024 : 512) : size;
    t.setImage(
      await texture(Buffer.from(image), limit, space, format, building && space === 'srgb'),
    ).setMimeType(format === 'ktx2' ? 'image/ktx2' : 'image/webp');
  }
  doc.createExtension(format === 'ktx2' ? KHRTextureBasisu : EXTTextureWebP).setRequired(true);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }), prune(), unpartition());
  const bytes = await io.writeBinary(doc);
  if (bytes.length > 95 * 1024 * 1024) throw Error('Single asset exceeds release budget');
  const filename = `${name}-${format}-${hash(bytes).slice(0, 10)}.glb`;
  await fs.writeFile(`${out}/${filename}`, bytes);
  let triangles = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives())
      triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  products.push({
    filename,
    bytes: bytes.length,
    sha256: hash(bytes),
    triangles: Math.round(triangles),
    textureMaximum: size,
    textureCount: doc.getRoot().listTextures().length,
  });
  console.log(filename, bytes.length);
  return '/game-assets/' + filename;
}
const car = await io.read('.asset-cache/car.glb');
car
  .getRoot()
  .listAnimations()
  .forEach((a) => a.dispose());
for (const e of car.getRoot().listExtensionsUsed())
  if (['KHR_materials_variants', 'KHR_draco_mesh_compression'].includes(e.extensionName))
    e.dispose();
for (const n of car.getRoot().listNodes())
  if (/Emblem|License Plate/.test(n.getName())) n.dispose();
await car.transform(prune(), dedup(), weld());
const hero = {
  ktx2: await emit('car-hero', car, 2048, 'ktx2'),
  fallback: await emit('car-hero', car, 2048, 'webp'),
};
const { combined } = await assembleBistro();
const districts = {};
for (const [level, ratio, error, size] of [
  ['medium', 0.18, 0.008, 1024],
  ['high', 0.85, 0.0007, 2048],
]) {
  const doc = new Document(),
    m = mergeDocuments(doc, combined);
  doc.getRoot().setDefaultScene(m.get(combined.getRoot().getDefaultScene()));
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }), prune(), dedup());
  districts[level] = {
    ktx2: await emit('district-next-' + level, doc, size, 'ktx2'),
    fallback: await emit('district-next-' + level, doc, size, 'webp'),
  };
}
const surfaces = {};
for (const name of ['asphalt', 'pavement']) {
  surfaces[name] = {};
  for (const channel of ['color', 'normal', 'roughness']) {
    const raw = await fs.readFile(`${cache}/${name}-${channel}.png`),
      space = channel === 'color' ? 'srgb' : 'linear';
    surfaces[name][channel] = {};
    for (const format of ['ktx2', 'webp']) {
      const b = await texture(raw, 2048, space, format),
        file = `${name}-next-${channel}-${hash(b).slice(0, 10)}.${format}`;
      await fs.writeFile(out + '/' + file, b);
      surfaces[name][channel][format] = '/game-assets/' + file;
      products.push({
        filename: file,
        bytes: b.length,
        sha256: hash(b),
        sourceResolution: (await sharp(raw).metadata()).width,
      });
    }
  }
}
const basis = 'basis-r186';
await fs.mkdir(out + '/' + basis, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm', 'README.md'])
  await fs.copyFile('node_modules/three/examples/jsm/libs/basis/' + f, out + '/' + basis + '/' + f);
const license = await fs.readFile(cache + '/Basis-LICENSE');
await fs.writeFile(out + '/' + basis + '/LICENSE', license);
const manifest = {
  version: 2,
  basisPath: '/game-assets/' + basis + '/',
  car: hero,
  district: districts,
  surfaces,
  products,
  sources: old.sources.map((s) => ({
    ...s,
    commercialUsePermitted: true,
    attributionRequired: s.license === 'CC-BY-4.0',
  })),
  roadSource: {
    name: 'Bistro Pavement Ground Wet / Curbstones',
    author: 'Amazon Lumberyard; Godot port Logan Preshaw; modifications Jamsers',
    source: 'https://github.com/Jamsers/Bistro-Demo-Tweaked/tree/main/Textures',
    license: 'CC-BY-4.0',
    commercialUsePermitted: true,
    attributionRequired: true,
    modifications:
      'Format conversion, KTX2 mip generation; NEXUS-authored roughness based on original .73 material scalar and subtle grain variance; no upscaling',
  },
  notes: [
    'Original source resolution caps every output; 4096 preset is a ceiling, not an upscaling claim',
    'Old versioned assets retained for fallback and comparison',
    'Meshes use Meshopt; building color uses Basis ETC1S, linear maps and hero/road textures use UASTC; full mip chains',
    'Runtime decoder from Three.js r186 / Binomial Basis Universal Apache-2.0',
  ],
};
await fs.writeFile(out + '/graphics-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await import('./prepare-basis-worker.mjs');
console.log('Next graphics assets prepared with explicit licenses and hashed filenames');
