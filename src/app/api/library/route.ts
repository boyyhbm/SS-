import { readJson } from '@/lib/security';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { librarySchema } from '@/lib/validation';
import { api, assertSameOrigin, ApiError, rateLimit } from '@/lib/security';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`library:${user.id}`, 120, 60);
    const { gameId, action } = librarySchema.parse(await readJson(request));
    const where = { userId_gameId: { userId: user.id, gameId } };
    if (action === 'remove')
      await db.userLibrary.deleteMany({ where: { userId: user.id, gameId } });
    else if (action === 'favorite') {
      const entry = await db.userLibrary.findUnique({ where });
      if (!entry) throw new ApiError(404, 'notInLibrary');
      await db.userLibrary.update({ where, data: { isFavorite: !entry.isFavorite } });
    } else {
      const game = await db.game.findFirst({
        where: { id: gameId, published: true, status: 'AVAILABLE' },
      });
      if (!game) throw new ApiError(404, 'gameUnavailable');
      // Restore last-played metadata from history; saves are independent of membership.
      const last = await db.gameSession.findFirst({
        where: { userId: user.id, gameId },
        orderBy: { startedAt: 'desc' },
      });
      await db.userLibrary.upsert({
        where,
        create: { userId: user.id, gameId, lastPlayedAt: last?.startedAt },
        update: {},
      });
    }
    return Response.json({ ok: true });
  });
}
