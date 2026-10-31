import 'dotenv/config';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import {
  mediaStorageLimit,
  storeDatabaseImages,
  uploadedImageName,
  validateUploadedImage,
} from '../src/lib/uploads';

// Operates on an already extracted private uploads backup. Never contacts the
// source host, extracts archives, deletes files or sends game assets anywhere.
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const option = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--'))
      throw Error('Missing option');
    return args[index + 1];
  };
  const directory = path.resolve(option('--directory'));
  const manifestPath = path.resolve(option('--manifest'));
  if (!(await lstat(directory)).isDirectory()) throw Error('A real backup directory is required');
  const images: { file: string; content: Buffer }[] = [];
  let bytes = 0;
  const limit = mediaStorageLimit();
  for (const file of (await readdir(directory)).sort()) {
    if (!uploadedImageName.test(file)) throw Error('Backup contains an unsupported file');
    const filename = path.join(directory, file);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error('Backup must contain regular images only');
    bytes += stat.size;
    if (bytes > limit) throw Error('Backup exceeds the configured media quota');
    const content = await readFile(filename);
    validateUploadedImage(file, content);
    const metadata = await sharp(content, { limitInputPixels: 20_000_000 }).metadata();
    if (metadata.format !== 'webp') throw Error('Backup contains an invalid image');
    images.push({ file, content });
  }
  const manifest = {
    version: 1,
    bytes,
    images: images.map(({ file, content }) => ({
      file,
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    })),
  };
  if (!apply) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      `Media preflight: ${images.length} images, ${bytes} bytes. Manifest written; database untouched.`,
    );
    return;
  }
  if (process.env.NEXUS_MIGRATION_HOLD !== '1' || process.env.NEXUS_MEDIA_STORE !== 'database')
    throw Error('Apply requires migration hold and database media storage on the destination');
  const expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(manifest))
    throw Error('The backup differs from its preflight manifest');
  const result = await storeDatabaseImages(images);
  console.log(
    `Media import verified: ${result.imported} new images; ${result.bytes} stored bytes. Source untouched.`,
  );
}

main()
  .catch(() => {
    console.error(
      'Media migration refused or failed. Check backup, manifest, destination and quota; no credentials logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
