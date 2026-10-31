import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mediaStorageLimit,
  mediaStorageMode,
  readUploadedImage,
  saveUploadedImage,
  uploadedImageExists,
} from '../src/lib/uploads';
import { GET } from '../src/app/api/media/[file]/route';

let directory: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('existing filesystem uploads', () => {
  it('keeps images and their public URLs on the configured persistent directory', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'nexus-upload-'));
    vi.stubEnv('NEXUS_UPLOAD_DIR', directory);
    vi.stubEnv('NEXUS_MEDIA_STORE', 'filesystem');
    const file = `${randomUUID()}.webp`;
    const image = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#334866' },
    })
      .webp()
      .toBuffer();
    await saveUploadedImage(file, image);
    expect(await uploadedImageExists(file)).toBe(true);
    expect(Buffer.from((await readUploadedImage(file))!)).toEqual(image);
    const response = await GET(new Request(`http://localhost/api/media/${file}`), {
      params: Promise.resolve({ file }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    await expect(saveUploadedImage(file, image)).rejects.toThrow();
    expect(await readUploadedImage(`${randomUUID()}.webp`)).toBeNull();
    expect(await uploadedImageExists('../secret.webp')).toBe(false);
    await expect(saveUploadedImage('../secret.webp', image)).rejects.toThrow();
    await expect(
      saveUploadedImage(`${randomUUID()}.webp`, Buffer.from('not an image')),
    ).rejects.toThrow();
  });
  it('fails closed on misspelled storage modes and invalid quotas', () => {
    vi.stubEnv('NEXUS_MEDIA_STORE', 'databse');
    expect(mediaStorageMode).toThrow();
    for (const value of ['0', '-1', 'NaN', '50 MB', '9007199254740992']) {
      vi.stubEnv('NEXUS_MEDIA_LIMIT_BYTES', value);
      expect(mediaStorageLimit).toThrow();
    }
  });
});
