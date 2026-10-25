import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { requireAdmin } from '@/lib/auth';
import { api, assertSameOrigin, ApiError, rateLimit, readLimitedBody } from '@/lib/security';
import { uploadDirectory } from '@/lib/uploads';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireAdmin();
    await rateLimit(`upload:${user.id}`, 20, 60);
    if (Number(request.headers.get('content-length') ?? 0) > 5_500_000)
      throw new ApiError(413, 'imageInvalid');
    const body = await readLimitedBody(request, 5_500_000);
    const data = await new Response(body, {
      headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
    }).formData();
    const file = data.get('image');
    if (
      !(file instanceof File) ||
      file.size > 5_000_000 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    )
      throw new ApiError(400, 'imageInvalid');
    let output: Buffer;
    try {
      const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20_000_000 });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new Error();
      output = await image
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      throw new ApiError(400, 'imageInvalid');
    }
    const name = `${randomUUID()}.webp`;
    const folder = uploadDirectory();
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, name), output, { flag: 'wx' });
    return Response.json({ url: `/api/media/${name}` });
  });
}
