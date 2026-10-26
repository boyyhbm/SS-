// Reproducible, pinned CC0 Car Kit import. No remote code is executed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';
const ref = '3c098d5612dd545f00c7355bedd1cb6fb6576b9c';
const root = 'https://raw.githubusercontent.com/leaukojo/carlito/' + ref + '/kit/raw/parked/';
const cache = '.asset-cache/racing-experience/source',
  output = 'public/game-assets/vehicles';
await fs.mkdir(path.join(cache, 'Textures'), { recursive: true });
await fs.mkdir(output, { recursive: true });
const files = {
  'hatchback-sports': 'bd5c9d4c3b4bdd254a66b8426563a68b1487ae7a5076df3a2488e6ffed7be64f',
  sedan: 'b532ea7d2c59f7f6b22b138cf1955218a2c1898f1cea932af4d3fd563c3959b7',
  'sedan-sports': '2889c428ca1dd9c975c3ff760eb8757883490410555ab60b818f712f583826d6',
  race: 'e1408c4c6e135f5a39c5f34cbfbcac9ae21c5c491e793fdee74bccac8334d942',
  'race-future': '869e2a58d2c12de474e824aff137334491b8f234b97127cf23f1ea04e42deec6',
};
async function fetchFile(file) {
  let b;
  try {
    b = await fs.readFile(path.join(cache, file));
  } catch {
    const r = await fetch(root + file);
    if (!r.ok) throw Error(file + ' ' + r.status);
    b = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(path.join(cache, file), b);
  }
  return b;
}
const license = (await fetchFile('License.txt')).toString();
if (!license.includes('CC0') || !license.includes('commercial purposes'))
  throw Error('Explicit asset license missing');
await fs.writeFile(path.join(output, 'Kenney-Car-Kit-License.txt'), license);
const palette = await fetchFile('Textures/colormap.png');
const { data, info } = await sharp(palette)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  manifest = {
    source: 'Kenney Car Kit 3.1',
    author: 'Kenney',
    license: 'CC0-1.0',
    commercialUse: true,
    sourceUrl: 'https://kenney.nl/assets/car-kit',
    mirror: 'https://github.com/leaukojo/carlito/tree/' + ref + '/kit/raw/parked',
    licenseFile: '/game-assets/vehicles/Kenney-Car-Kit-License.txt',
    modifications: [
      'Metric normalization',
      'Articulated wheel naming',
      'Source palette separated into PBR materials',
      'Original geometry retained',
    ],
    models: {},
  };
for (const [name, expected] of Object.entries(files)) {
  const bytes = await fetchFile(name + '.glb');
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw Error('Source hash mismatch ' + name);
  const doc = await io.read(path.join(cache, name + '.glb')),
    clearcoat = doc.createExtension(KHRMaterialsClearcoat),
    buf = doc.getRoot().listBuffers()[0];
  const nodes = doc.getRoot().listNodes(),
    bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const node of nodes) {
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      for (let i = 0; i < a.getCount(); i++) {
        const v = a.getElement(i, [0, 0, 0]);
        for (let d = 0; d < 3; d++) {
          const x = m[d] * v[0] + m[4 + d] * v[1] + m[8 + d] * v[2] + m[12 + d];
          bounds.min[d] = Math.min(bounds.min[d], x);
          bounds.max[d] = Math.max(bounds.max[d], x);
        }
      }
    }
  }
  const counts = new Map();
  function faceColor(uv, ids) {
    let u = 0,
      v = 0;
    for (const i of ids) {
      const a = uv?.getElement(i, [0, 0]) ?? [0, 0];
      u += a[0] / 3;
      v += a[1] / 3;
    }
    const x = Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width))),
      y = Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height))),
      p = (y * info.width + x) * 4;
    return Array.from(data.subarray(p, p + 3));
  }
  for (const node of nodes) {
    if (!/body/.test(node.getName())) continue;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const ids =
          prim.getIndices()?.getArray() ??
          Array.from({ length: prim.getAttribute('POSITION').getCount() }, (_, i) => i),
        uv = prim.getAttribute('TEXCOORD_0');
      for (let i = 0; i < ids.length; i += 3) {
        const c = faceColor(uv, [ids[i], ids[i + 1], ids[i + 2]]);
        if (Math.max(...c) - Math.min(...c) > 35 && Math.max(...c) > 75) {
          const k = c.join(',');
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
  }
  const paint = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '255,255,255';
  const materials = new Map();
  let triangles = 0;
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const wheel = /wheel/.test(node.getName());
    for (const prim of [...mesh.listPrimitives()]) {
      const indices =
          prim.getIndices()?.getArray() ??
          Array.from({ length: prim.getAttribute('POSITION').getCount() }, (_, i) => i),
        uv = prim.getAttribute('TEXCOORD_0'),
        parts = new Map();
      for (let i = 0; i < indices.length; i += 3) {
        const ids = [indices[i], indices[i + 1], indices[i + 2]],
          c = faceColor(uv, ids),
          key = c.join(',');
        if (!parts.has(key)) parts.set(key, { c, ids: [] });
        parts.get(key).ids.push(...ids);
        triangles++;
      }
      mesh.removePrimitive(prim);
      for (const [key, { c, ids }] of parts) {
        const kind =
          !wheel && key === paint
            ? 'Paint 1'
            : wheel
              ? Math.max(...c) < 90
                ? 'Tire'
                : 'Rim'
              : Math.max(...c) < 75
                ? 'Trim'
                : Math.max(...c) - Math.min(...c) < 30 && c[0] < 170
                  ? 'Glass'
                  : 'Detail';
        const mk = kind + key;
        let mat = materials.get(mk);
        if (!mat) {
          mat = doc
            .createMaterial(kind)
            .setBaseColorFactor([...c.map((v) => (v / 255) ** 2.2), 1])
            .setRoughnessFactor(kind === 'Tire' ? 0.92 : kind === 'Glass' ? 0.15 : 0.38)
            .setMetallicFactor(kind === 'Rim' ? 0.82 : kind === 'Paint 1' ? 0.55 : 0);
          if (kind === 'Paint 1')
            mat.setExtension(
              'KHR_materials_clearcoat',
              clearcoat.createClearcoat().setClearcoatFactor(0.8).setClearcoatRoughnessFactor(0.16),
            );
          materials.set(mk, mat);
        }
        const part = doc.createPrimitive().setMaterial(mat);
        for (const semantic of prim.listSemantics())
          part.setAttribute(semantic, prim.getAttribute(semantic));
        part.setIndices(
          doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(ids)).setBuffer(buf),
        );
        mesh.addPrimitive(part);
      }
    }
    const renamed = {
      'wheel-front-left': 'WheelFrontL',
      'wheel-front-right': 'WheelFrontR',
      'wheel-back-left': 'WheelRearL',
      'wheel-back-right': 'WheelRearR',
    };
    if (renamed[node.getName()]) node.setName(renamed[node.getName()]);
  }
  const front = nodes.find((n) => n.getName() === 'WheelFrontL')?.getWorldTranslation(),
    back = nodes.find((n) => n.getName() === 'WheelRearL')?.getWorldTranslation();
  const scale =
    (name === 'hatchback-sports' ? 4.05 : name === 'sedan' ? 4.9 : 4.5) /
    (bounds.max[2] - bounds.min[2]);
  const parent = doc
    .createNode('VehicleRoot')
    .setScale([scale, scale, scale])
    .setTranslation([
      (-(bounds.min[0] + bounds.max[0]) / 2) * scale,
      -bounds.min[1] * scale,
      (-(bounds.min[2] + bounds.max[2]) / 2) * scale,
    ])
    .setExtras({ frontDisplaySteer: 0 });
  if (front && back && front[2] < back[2]) parent.setRotation([0, 1, 0, 0]);
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of [...scene.listChildren()]) {
      scene.removeChild(child);
      parent.addChild(child);
    }
    scene.addChild(parent);
  }
  await doc.transform(prune());
  const out = Buffer.from(await io.writeBinary(doc)),
    hash = createHash('sha256').update(out).digest('hex'),
    file = name + '-' + hash.slice(0, 10) + '.glb';
  await fs.writeFile(path.join(output, file), out);
  manifest.models[name] = {
    path: '/game-assets/vehicles/' + file,
    bytes: out.length,
    sha256: hash,
    sourceSha256: expected,
    sourceUrl: root + name + '.glb',
    triangles,
    nativeSourceDetail: 'stylized authored Car Kit geometry; not a high-poly photoreal vehicle',
  };
  console.log(name, triangles + ' triangles', out.length + ' bytes');
}
await fs.writeFile(
  'public/game-assets/vehicle-manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
