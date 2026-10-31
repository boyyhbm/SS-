import { access } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { readJson } from '@/lib/security';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { gameSchema } from '@/lib/validation';
import { api, assertSameOrigin, ApiError } from '@/lib/security';
import { z } from 'zod';
import { uploadedImageExists } from '@/lib/uploads';
export async function GET() {
  return api(async () => {
    await requireAdmin();
    return Response.json(await db.game.findMany({ orderBy: { sortOrder: 'asc' } }));
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { id, ...input } = gameSchema.parse(await readJson(request));
    for (const image of [input.cover, input.banner]) {
      try {
        if (image.startsWith('/art/'))
          await access(path.join(process.cwd(), 'public', image.slice(1)));
        else if (!(await uploadedImageExists(path.basename(image)))) throw Error();
      } catch {
        throw new ApiError(400, 'imageInvalid');
      }
    }
    const data = { ...input, runtimeKey: input.runtimeKey || null };
    try {
      const game = id
        ? await db.game.update({ where: { id }, data })
        : await db.game.create({ data: { ...data, screenshots: [] } });
      return Response.json({ id: game.id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ApiError(409, 'slugTaken');
      throw error;
    }
  });
}
export async function DELETE(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(await readJson(request));
    await db.$transaction(async (tx) => {
      const [sessions, saves, matches] = await Promise.all([
        tx.gameSession.count({ where: { gameId: id } }),
        tx.gameSave.count({ where: { gameId: id } }),
        tx.multiplayerMatch.count({ where: { gameId: id } }),
      ]);
      if (sessions || saves || matches) throw new ApiError(409, 'archiveInstead');
      await tx.game.delete({ where: { id } });
    });
    return Response.json({ ok: true });
  });
}
