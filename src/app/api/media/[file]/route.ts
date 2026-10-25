import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadDirectory } from '@/lib/uploads';
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!/^[a-f0-9-]{36}\.webp$/.test(file)) return new Response(null, { status: 404 });
  try {
    const data = await readFile(path.join(uploadDirectory(), file));
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
