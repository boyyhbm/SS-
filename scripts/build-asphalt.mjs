import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const digest = (b) => createHash('sha256').update(b).digest('hex');
export async function buildAsphalt(products, output = 'public/game-assets') {
  // Original tileable PBR asphalt: stone aggregate, mineral albedo, coherent damp patches.
  const size = 1024,
    height = new Float32Array(size * size),
    wet = new Float32Array(size * size);
  const color = Buffer.alloc(size * size * 3),
    normal = Buffer.alloc(size * size * 3),
    rough = Buffer.alloc(size * size * 3);
  const hash = (x, y) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n >>> 0) / 4294967295;
  };
  const noise = (x, y, n) => {
    x = (x % size) / n;
    y = (y % size) / n;
    const a = Math.floor(x),
      b = Math.floor(y),
      tx = x - a,
      ty = y - b,
      u = tx * tx * (3 - 2 * tx),
      v = ty * ty * (3 - 2 * ty),
      w = size / n,
      h = (i, j) => hash((i + w) % w, (j + w) % w);
    return (
      (h(a, b) * (1 - u) + h(a + 1, b) * u) * (1 - v) +
      (h(a, b + 1) * (1 - u) + h(a + 1, b + 1) * u) * v
    );
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        grain = hash(x, y),
        aggregate = noise(x, y, 4);
      height[i] = grain * 0.33 + aggregate * 0.67;
      wet[i] = Math.max(
        0,
        Math.min(1, (noise(x, y, 128) * 0.75 + noise(x, y, 256) * 0.25 - 0.44) * 6),
      );
      const v = 32 + grain * 8 + aggregate * 14 - wet[i] * 4;
      color[i * 3] = v * 0.89;
      color[i * 3 + 1] = v * 0.96;
      color[i * 3 + 2] = v;
      const r = 150 + (1 - wet[i]) * 40;
      rough.fill(Math.round(r), i * 3, i * 3 + 3);
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        dx =
          (height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)]) * 0.7,
        dy =
          (height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x]) * 0.7,
        l = Math.hypot(dx, dy, 1);
      normal[i * 3] = 128 - (dx / l) * 127;
      normal[i * 3 + 1] = 128 - (dy / l) * 127;
      normal[i * 3 + 2] = 128 + 127 / l;
    }
  for (const [name, data, lossless] of [
    ['asphalt-color', color, false],
    ['asphalt-normal', normal, true],
    ['asphalt-roughness', rough, true],
  ]) {
    const b = await sharp(data, { raw: { width: size, height: size, channels: 3 } })
      .webp({ quality: 88, lossless })
      .toBuffer();
    await writeFile(`${output}/${name}.webp`, b);
    products.push({ filename: `${name}.webp`, bytes: b.length, sha256: digest(b) });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = 'public/game-assets/manifest.json';
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.products = manifest.products.filter((p) => !p.filename.startsWith('asphalt-'));
  await buildAsphalt(manifest.products);
  await writeFile(path, JSON.stringify(manifest, null, 2));
}
