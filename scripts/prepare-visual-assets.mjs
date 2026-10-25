// Reviewed art sources only. Models are self-contained; no remote runtime resources.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  prune,
  dedup,
  weld,
  simplify,
  textureCompress,
  meshopt,
  getBounds,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco from 'draco3dgltf';
import sharp from 'sharp';
const cache = '.asset-cache',
  output = 'public/game-assets';
await mkdir(cache, { recursive: true });
await mkdir(`${output}/licenses`, { recursive: true });
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const sources = [
  {
    key: 'car',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb',
    author: 'Eric Chadwick / Darmstadt Graphics Group GmbH (2024); original concept by Unity Fan',
    license: 'CC-BY-4.0',
    page: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept',
  },
  {
    key: 'environment',
    url: 'https://raw.githubusercontent.com/pmndrs/drei-assets/master/hdri/venice_sunset_1k.hdr',
    author: 'HDRI Haven / Poly Haven contributors, mirrored by pmndrs',
    license: 'CC0-1.0',
    page: 'https://polyhaven.com/a/venice_sunset',
  },
];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const previous = await readFile(`${output}/manifest.json`, 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const downloaded = [];
for (const source of sources) {
  const path = `${cache}/${source.key}.${source.key === 'environment' ? 'hdr' : 'glb'}`;
  let bytes = await readFile(path).catch(() => null);
  if (!bytes) {
    const response = await fetch(source.url);
    if (!response.ok) throw Error(`Asset download failed: ${source.key} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path, bytes);
  }
  const hash = digest(bytes),
    pinned = previous?.sources.find((s) => s.key === source.key)?.sha256;
  if (pinned && pinned !== hash)
    throw Error(
      `Source changed: ${source.key}. Review content and license before accepting a new hash.`,
    );
  downloaded.push({ ...source, sha256: hash, sourceBytes: bytes.length });
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const products = [];
for (const key of ['car'])
  for (const level of ['high', 'low']) {
    const doc = await io.read(`${cache}/${key}.glb`);
    doc
      .getRoot()
      .listAnimations()
      .forEach((a) => a.dispose());
    for (const ext of doc.getRoot().listExtensionsUsed())
      if (['KHR_materials_variants', 'KHR_draco_mesh_compression'].includes(ext.extensionName))
        ext.dispose();
    for (const n of doc.getRoot().listNodes())
      if (/Emblem|License Plate/.test(n.getName())) n.dispose();
    for (const mat of doc.getRoot().listMaterials()) {
      const tex = mat.getBaseColorTexture();
      if (tex && /khronos/i.test(tex.getURI() + tex.getName())) mat.setBaseColorTexture(null);
    }
    await doc.transform(
      prune(),
      dedup(),
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: level === 'high' ? 0.82 : 0.04,
        error: level === 'high' ? 0.0004 : 0.025,
      }),
    );
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: level === 'high' ? [1024, 1024] : [512, 512],
        quality: 88,
        slots: /^(?!normalTexture).*$/,
      }),
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: level === 'high' ? [1024, 1024] : [512, 512],
        lossless: true,
        slots: /normalTexture/,
      }),
      meshopt({ encoder: MeshoptEncoder, level: 'high' }),
      prune(),
    );
    const bytes = await io.writeBinary(doc),
      filename = `${key}-${level}.glb`;
    await writeFile(`${output}/${filename}`, bytes);
    let triangles = 0;
    for (const mesh of doc.getRoot().listMeshes())
      for (const p of mesh.listPrimitives())
        triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    products.push({
      filename,
      bytes: bytes.length,
      sha256: digest(bytes),
      triangles: Math.round(triangles),
      bounds,
    });
    console.log(
      `${filename}: ${(bytes.length / 1048576).toFixed(2)} MiB, ${Math.round(triangles)} triangles`,
    );
  }
const { buildBistro } = await import('./build-bistro.mjs');
downloaded.push(await buildBistro(products));
await copyFile(`${cache}/environment.hdr`, `${output}/environment.hdr`);
const { buildAsphalt } = await import('./build-asphalt.mjs');
await buildAsphalt(products, output);
for (const [filename, url] of [
  [
    'CC-BY-4.0.txt',
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/LICENSES/CC-BY-4.0.txt',
  ],
  [
    'CC0-1.0.txt',
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/LICENSES/CC0-1.0.txt',
  ],
  [
    'car-source.md',
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/README.md',
  ],
  [
    'environment-source.md',
    'https://raw.githubusercontent.com/pmndrs/drei-assets/master/README.md',
  ],
]) {
  const r = await fetch(url);
  if (!r.ok) throw Error(`License evidence unavailable: ${filename}`);
  await writeFile(`${output}/licenses/${filename}`, await r.text());
}
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      version: 1,
      sources: downloaded,
      modifications:
        'Car: removed emblem/plate nodes, logo texture and variants, geometry/texture LOD and Meshopt compression. District: selected Amazon Lumberyard Bistro buildings and props from the CC BY Godot port. Reconstructed source materials from scene overrides, decoded DDS textures, normalized pivots, geometry and texture LOD. NEXUS authors the track, props, lighting and PBR asphalt. Licensed models are not claimed as NEXUS originals.',
      products,
    },
    null,
    2,
  ),
);
