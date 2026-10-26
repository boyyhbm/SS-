import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const exec = promisify(execFile),
  ktx = process.env.KTX_BIN ?? 'toktx',
  cache = '.asset-cache/next';
const hash = (b) => createHash('sha256').update(b).digest('hex');
await fs.mkdir(cache, { recursive: true });
export async function encodeAssetTexture(image, size, colorSpace, format, compact = false) {
  const key = hash(
      Buffer.concat([
        image,
        Buffer.from(
          `${size}:${colorSpace}:${format}:${compact && format === 'ktx2' ? 'etc1s-q255' : 'uastc'}:${format === 'webp' ? 'q96-v2' : ''}`,
        ),
      ]),
    ),
    file = `${cache}/${key}.${format === 'ktx2' ? 'ktx2' : 'webp'}`;
  const cached = await fs.readFile(file).catch(() => null);
  if (cached) {
    if (format !== 'ktx2') return cached;
    try {
      await exec(path.join(path.dirname(ktx), 'ktx'), ['validate', file]);
      return cached;
    } catch {
      await fs.unlink(file);
    }
  }
  const resized = sharp(image).resize({
    width: size,
    height: size,
    fit: 'inside',
    withoutEnlargement: true,
  });
  if (format === 'webp') {
    const b = await resized.webp({ quality: colorSpace === 'linear' ? 96 : 94 }).toBuffer();
    await fs.writeFile(file, b);
    return b;
  }
  const png = `${cache}/${key}.png`;
  await resized.png().toFile(png);
  const temporary = file + '.building.ktx2';
  const encoding = compact
    ? ['--encode', 'etc1s', '--clevel', '3', '--qlevel', '255']
    : ['--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18'];
  await exec(
    ktx,
    [
      '--t2',
      ...encoding,
      '--genmipmap',
      '--assign_oetf',
      colorSpace === 'srgb' ? 'srgb' : 'linear',
      temporary,
      png,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  await fs.rename(temporary, file);
  await fs.unlink(png);
  return fs.readFile(file);
}
