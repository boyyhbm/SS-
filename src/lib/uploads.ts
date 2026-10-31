import path from 'node:path';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { db } from './db';

export const uploadedImageName = /^[a-f0-9-]{36}\.webp$/;
export const maxUploadedImageBytes = 5_000_000;

export class MediaStorageFullError extends Error {}

export function mediaStorageMode() {
  const mode = process.env.NEXUS_MEDIA_STORE ?? 'filesystem';
  if (mode !== 'filesystem' && mode !== 'database') throw Error('Invalid media store');
  return mode;
}

export function mediaStorageLimit() {
  const value = process.env.NEXUS_MEDIA_LIMIT_BYTES;
  const limit = Number(value);
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(limit) || limit < 1)
    throw Error('A positive database media quota is required');
  return limit;
}

// Filesystem remains the default on existing installations.
export function uploadDirectory() {
  return process.env.NEXUS_UPLOAD_DIR ?? path.join(process.cwd(), 'storage/uploads');
}

export function validateUploadedImage(file: string, content: Uint8Array) {
  if (
    !uploadedImageName.test(file) ||
    content.byteLength < 12 ||
    content.byteLength > maxUploadedImageBytes ||
    Buffer.from(content.subarray(0, 4)).toString('ascii') !== 'RIFF' ||
    Buffer.from(content.subarray(8, 12)).toString('ascii') !== 'WEBP'
  )
    throw Error('Only validated WebP image uploads can be stored');
}

// Migration imports are idempotent, but never replace an immutable public URL
// with different bytes. The same lock protects ordinary concurrent uploads.
export async function storeDatabaseImages(images: { file: string; content: Uint8Array }[]) {
  const limit = mediaStorageLimit();
  for (const image of images) validateUploadedImage(image.file, image.content);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(1313167438, 1296385097)::text`;
      const totals = await tx.uploadedImage.aggregate({ _sum: { size: true } });
      let used = totals._sum.size ?? 0;
      let imported = 0;
      for (const { file, content } of images) {
        const sha256 = createHash('sha256').update(content).digest('hex');
        const existing = await tx.uploadedImage.findUnique({
          where: { file },
          select: { sha256: true },
        });
        if (existing) {
          if (existing.sha256 !== sha256)
            throw Error('Media import conflicts with an existing image');
          continue;
        }
        used += content.byteLength;
        if (used > limit) throw new MediaStorageFullError('Database media quota reached');
        await tx.uploadedImage.create({
          data: { file, content: new Uint8Array(content), sha256, size: content.byteLength },
        });
        imported++;
      }
      return { imported, bytes: used };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export async function saveUploadedImage(file: string, content: Uint8Array) {
  validateUploadedImage(file, content);
  if (mediaStorageMode() === 'database') {
    await storeDatabaseImages([{ file, content }]);
  } else {
    await mkdir(uploadDirectory(), { recursive: true });
    await writeFile(path.join(uploadDirectory(), file), content, { flag: 'wx' });
  }
}

export async function readUploadedImage(file: string) {
  if (!uploadedImageName.test(file)) return null;
  if (mediaStorageMode() === 'database') {
    const image = await db.uploadedImage.findUnique({ where: { file }, select: { content: true } });
    return image?.content ?? null;
  }
  try {
    return await readFile(path.join(uploadDirectory(), file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function uploadedImageExists(file: string) {
  if (!uploadedImageName.test(file)) return false;
  if (mediaStorageMode() === 'database')
    return (await db.uploadedImage.count({ where: { file } })) === 1;
  try {
    await access(path.join(uploadDirectory(), file));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
