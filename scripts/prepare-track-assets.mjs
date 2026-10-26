import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const ref = '3c098d5612dd545f00c7355bedd1cb6fb6576b9c',
  root = 'https://raw.githubusercontent.com/leaukojo/carlito/' + ref + '/kit/raw/';
const packs = {
  racing: [
    'grandStandCovered',
    'pitsGarage',
    'barrierWall',
    'lightPostModern',
    'overheadLights',
    'pylon',
  ],
  nature: ['tree_pineDefaultA', 'tree_pineRoundA', 'tree_palm', 'rock_largeA', 'rock_largeC'],
};
const out = 'public/game-assets/track-props';
await fs.mkdir(out, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  manifest = {
    author: 'Kenney',
    license: 'CC0-1.0',
    commercialUse: true,
    mirror: 'https://github.com/leaukojo/carlito/tree/' + ref + '/kit/raw',
    packs: {},
    models: {},
  };
for (const [pack, names] of Object.entries(packs)) {
  const cache = '.asset-cache/racing-experience/props/' + pack;
  await fs.mkdir(cache + '/Textures', { recursive: true });
  async function get(file) {
    let b;
    try {
      return await fs.readFile(cache + '/' + file);
    } catch {
      const r = await fetch(root + pack + '/' + file, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Error(pack + '/' + file + ' ' + r.status);
      b = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(cache + '/' + file, b);
      return b;
    }
  }
  const license = (await get('License.txt')).toString();
  if (!license.includes('CC0') || !/commercial (purposes|projects)/.test(license))
    throw Error('Explicit CC0 license missing ' + pack);
  await fs.writeFile(out + '/' + pack + '-License.txt', license);
  manifest.packs[pack] = {
    licenseFile: '/game-assets/track-props/' + pack + '-License.txt',
    source: root + pack + '/License.txt',
  };
  for (const name of names) {
    const original = await get(name + '.glb');
    const json = JSON.parse(original.subarray(20, 20 + original.readUInt32LE(12)).toString());
    for (const image of json.images ?? []) {
      if (image.uri && !image.uri.startsWith('data:')) {
        if (
          !/^[a-zA-Z0-9_./-]+$/.test(image.uri) ||
          image.uri.includes('..') ||
          image.uri.startsWith('/')
        )
          throw Error('Unsafe source texture path');
        await fs.mkdir(path.dirname(cache + '/' + image.uri), { recursive: true });
        await get(image.uri);
      }
    }
    const doc = await io.read(cache + '/' + name + '.glb');
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let triangles = 0;
    for (const n of doc.getRoot().listNodes()) {
      const m = n.getWorldMatrix();
      for (const p of n.getMesh()?.listPrimitives() ?? []) {
        const a = p.getAttribute('POSITION');
        triangles += (p.getIndices()?.getCount() ?? a.getCount()) / 3;
        for (let i = 0; i < a.getCount(); i++) {
          const v = a.getElement(i, [0, 0, 0]);
          for (let j = 0; j < 3; j++) {
            const c = m[j] * v[0] + m[4 + j] * v[1] + m[8 + j] * v[2] + m[12 + j];
            bounds.min[j] = Math.min(bounds.min[j], c);
            bounds.max[j] = Math.max(bounds.max[j], c);
          }
        }
      }
    }
    const b = Buffer.from(await io.writeBinary(doc)),
      sha = createHash('sha256').update(b).digest('hex'),
      file = name + '-' + sha.slice(0, 10) + '.glb';
    await fs.writeFile(out + '/' + file, b);
    manifest.models[name] = {
      pack,
      path: '/game-assets/track-props/' + file,
      bytes: b.length,
      sha256: sha,
      sourceSha256: createHash('sha256').update(original).digest('hex'),
      sourceUrl: root + pack + '/' + name + '.glb',
      bounds,
      triangles,
    };
    console.log(name, triangles, b.length);
  }
}
await fs.writeFile(
  'public/game-assets/track-manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
