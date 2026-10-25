import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureTransform } from '@gltf-transform/extensions';
import {
  mergeDocuments,
  getBounds,
  prune,
  dedup,
  weld,
  simplify,
  meshopt,
  textureCompress,
  unpartition,
} from '@gltf-transform/functions';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
export async function buildBistro(products) {
  const descriptor = JSON.parse(await readFile('.asset-cache/bistro/descriptor.json', 'utf8'));
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const combined = new Document(),
    scene = combined.createScene('NEXUS_Bistro_Library');
  const cache = new Map();
  for (const [name, entry] of Object.entries(descriptor.models)) {
    const doc = await io.read(`.asset-cache/bistro/files/${entry.source}`);
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      // Godot sanitizes glTF node names: '.001' becomes '_001'. Reconstruct
      // those assignments as well, otherwise leaves and façade panels stay white.
      const path = entry.materials[node.getName()] ?? entry.materials[node.getName().replaceAll('.','_')];
      if (!path) continue;
      const spec = descriptor.materials[path];
      const mat = doc
        .createMaterial(spec.name)
        .setRoughnessFactor(spec.roughness ?? 0.75)
        .setMetallicFactor(spec.metallic ?? 0);
      const texture = async (field) => {
        const source = spec[field];
        if (!source) return null;
        const bytes = await readFile(descriptor.textures[source]);
        return doc.createTexture(source).setImage(bytes).setMimeType('image/webp');
      };
      mat.setBaseColorTexture(await texture('albedo_texture'));
      mat.setNormalTexture(await texture('normal_texture'));
      mat.setNormalScale(spec.normal_scale ?? 1);
      mat.setMetallicRoughnessTexture(await texture('roughness_texture'));
      if (spec.emission_texture) {
        mat
          .setEmissiveTexture(await texture('emission_texture'))
          .setEmissiveFactor([0.7, 0.58, 0.35]);
      }
      if (/Glass/.test(spec.name))
        mat
          .setBaseColorFactor([0.5, 0.62, 0.66, 0.9])
          .setRoughnessFactor(0.2)
          .setMetallicFactor(0.55);
      if(/Leaves|Leaf|Cypress|Hedge|Foliage|Ivy/i.test(spec.name)&&!/Trunk|Bark/i.test(spec.name))mat.setAlphaMode('MASK').setAlphaCutoff(.45).setDoubleSided(true).setRoughnessFactor(.9);
      if (spec.scale) {
        const ext = doc.createExtension(KHRTextureTransform);
        for (const info of [
          mat.getBaseColorTextureInfo(),
          mat.getNormalTextureInfo(),
          mat.getRoughnessTextureInfo(),
        ])
          if (info)
            info.setExtension('KHR_texture_transform', ext.createTransform().setScale(spec.scale));
      }
      for (const p of mesh.listPrimitives()) p.setMaterial(mat);
    }
    if(name==='S1Details'){
      const selected=[
        ['Tree',/Linde_Tree_Large_linde_tree_large_4051$/],
        ['Cypress',/Italian_Cypress5_3931$/],
        ['Hedge',/bux_hedge_box_long_low_3963$/],
      ];
      const originalScene=doc.getRoot().listScenes()[0],roots=[];
      for(const[label,pattern]of selected){const original=doc.getRoot().listNodes().find(n=>pattern.test(n.getName()));if(!original)throw Error('Reviewed foliage missing '+label);const matrix=original.getWorldMatrix();original.getParentNode()?.removeChild(original);original.setMatrix(matrix);const root=doc.createNode(`Bistro_${label}`);root.addChild(original);originalScene.addChild(root);const box=getBounds(root);root.setTranslation([-(box.min[0]+box.max[0])/2,-box.min[1],-(box.min[2]+box.max[2])/2]);roots.push(root);cache.set(label,box);}
      for(const child of [...originalScene.listChildren()])if(!roots.includes(child))originalScene.removeChild(child);
      const mapped=mergeDocuments(combined,doc);for(const root of roots)scene.addChild(mapped.get(root));
      continue;
    }
    // This building also contains four full cypress trees in the source export.
    // Reuse the separate reviewed foliage template instead of duplicating them in every façade.
    if(name==='S5B1')for(const n of doc.getRoot().listNodes())if(/Italian_Cypress/.test(n.getName())&&n.getMesh())n.dispose();
    const box = getBounds(doc.getRoot().listScenes()[0]),
      root = doc.createNode(`Bistro_${name}`),
      originalScene = doc.getRoot().listScenes()[0];
    for (const child of [...originalScene.listChildren()]) root.addChild(child);
    root.setTranslation([
      -(box.min[0] + box.max[0]) / 2,
      -box.min[1],
      -(box.min[2] + box.max[2]) / 2,
    ]);
    originalScene.addChild(root);
    const mapped = mergeDocuments(combined, doc);
    scene.addChild(mapped.get(root));
    cache.set(name, box);
  }
  // Discard imported source scene containers; keep the named reusable library scene.
  for (const s of combined.getRoot().listScenes()) if (s !== scene) s.dispose();
  combined.getRoot().setDefaultScene(scene);
  await combined.transform(prune(), dedup(), weld());
  for (const level of ['high', 'low']) {
    const doc = new Document();
    const mapping = mergeDocuments(doc, combined);
    doc.getRoot().setDefaultScene(mapping.get(scene));
    await doc.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: level === 'high' ? 0.65 : 0.012,
        error: level === 'high' ? 0.001 : 0.045,
      }),
      textureCompress({
        encoder: sharp,
        resize: level === 'high' ? [1024, 1024] : [512, 512],
        targetFormat: 'webp',
        quality: 88,
      }),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: 'high' }),
      unpartition(),
    );
    const bytes = await io.writeBinary(doc),
      filename = `district-${level}.glb`;
    await writeFile(`public/game-assets/${filename}`, bytes);
    let triangles = 0;
    for (const m of doc.getRoot().listMeshes())
      for (const p of m.listPrimitives())
        triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    products.push({
      filename,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      triangles: Math.round(triangles),
      templates: Object.fromEntries(cache),
    });
    console.log(
      `${filename}: ${(bytes.length / 1048576).toFixed(2)} MiB, ${Math.round(triangles)} triangles`,
    );
  }
  await copyFile(
    '.asset-cache/bistro/files/LICENSE-ASSETS',
    'public/game-assets/licenses/Bistro-CC-BY-4.0.txt',
  );
  await copyFile(
    '.asset-cache/bistro/files/ATTRIBUTION',
    'public/game-assets/licenses/Bistro-attribution.txt',
  );
  return {
    key: 'district',
    url: 'https://github.com/Jamsers/Bistro-Demo-Tweaked',
    author: descriptor.author,
    license: 'CC-BY-4.0',
    files: descriptor.evidence,
  };
}
