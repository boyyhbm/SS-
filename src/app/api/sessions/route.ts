import { readJson } from '@/lib/security';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { api, assertSameOrigin, ApiError, rateLimit } from '@/lib/security';
import { isPlayable } from '@/games/registry';
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), gameId: z.string().max(64) }),
  z.object({
    action: z.enum(['heartbeat', 'end', 'pause', 'resume']),
    sessionId: z.string().max(64),
  }),
  z.object({
    action: z.literal('lap'),
    sessionId: z.string().max(64),
    seconds: z.number().finite().min(8).max(3600),
  }),
]);
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`session:${user.id}`, 100, 60);
    const input = schema.parse(await readJson(request));
    if (input.action === 'start') {
      const entry = await db.userLibrary.findUnique({
        where: { userId_gameId: { userId: user.id, gameId: input.gameId } },
        include: { game: true },
      });
      if (!entry || !isPlayable(entry.game)) throw new ApiError(403, 'gameUnavailable');
      const session = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
        await tx.gameSession.updateMany({
          where: { userId: user.id, endedAt: null },
          data: { endedAt: new Date() },
        });
        await tx.userLibrary.update({
          where: { id: entry.id },
          data: { lastPlayedAt: new Date() },
        });
        return tx.gameSession.create({ data: { userId: user.id, gameId: input.gameId } });
      });
      return Response.json({ sessionId: session.id });
    }
    const session = await db.gameSession.findFirst({
      where: { id: input.sessionId, userId: user.id, endedAt: null },
    });
    if (!session) throw new ApiError(404, 'sessionUnavailable');
    if (input.action === 'lap') {
      if (input.seconds > (Date.now() - session.startedAt.getTime()) / 1000 + 2)
        throw new ApiError(400, 'invalidInput');
      const recordUpdated = await db.$transaction(async (tx) => {
        // Lock session to serialize best-lap updates; all queries remain scoped to this user.
        await tx.$queryRaw`SELECT id FROM "GameSession" WHERE id = ${session.id} FOR UPDATE`;
        const locked = await tx.gameSession.findUnique({ where: { id: session.id } });
        if (!locked || locked.endedAt) throw new ApiError(404, 'sessionUnavailable');
        const where = {
          userId_gameId_saveKey: { userId: user.id, gameId: session.gameId, saveKey: 'best-lap' },
        };
        const historyWhere = {
          userId_gameId_saveKey: {
            userId: user.id,
            gameId: session.gameId,
            saveKey: 'lap-history',
          },
        };
        const previousHistory = await tx.gameSave.findUnique({ where: historyWhere });
        const history = z
          .array(
            z.object({
              seconds: z.number().finite().min(8).max(3600),
              recordedAt: z.iso.datetime(),
            }),
          )
          .max(10)
          .safeParse(previousHistory?.saveData);
        const bestLaps = [
          ...(history.success ? history.data : []),
          { seconds: input.seconds, recordedAt: new Date().toISOString() },
        ]
          .sort((a, b) => a.seconds - b.seconds)
          .slice(0, 10);
        await tx.gameSave.upsert({
          where: historyWhere,
          create: {
            userId: user.id,
            gameId: session.gameId,
            saveKey: 'lap-history',
            saveData: bestLaps,
          },
          update: { saveData: bestLaps },
        });
        const old = await tx.gameSave.findUnique({ where });
        const oldSeconds =
          old?.saveData && typeof old.saveData === 'object' && 'seconds' in old.saveData
            ? Number(old.saveData.seconds)
            : Infinity;
        if (input.seconds < oldSeconds) {
          await tx.gameSave.upsert({
            where,
            create: {
              userId: user.id,
              gameId: session.gameId,
              saveKey: 'best-lap',
              saveData: { seconds: input.seconds },
            },
            update: { saveData: { seconds: input.seconds } },
          });
          return true;
        }
        return false;
      });
      return Response.json({ ok: true, recordUpdated });
    } else {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "GameSession" WHERE id = ${session.id} FOR UPDATE`;
        const current = await tx.gameSession.findUnique({ where: { id: session.id } });
        if (!current || current.endedAt) return;
        const elapsed =
          current.isPaused || input.action === 'resume'
            ? 0
            : Math.max(
                0,
                Math.min(45, Math.floor((Date.now() - current.lastHeartbeatAt.getTime()) / 1000)),
              );
        await tx.gameSession.update({
          where: { id: current.id },
          data: {
            durationSeconds: { increment: elapsed },
            lastHeartbeatAt: new Date(),
            isPaused:
              input.action === 'pause'
                ? true
                : input.action === 'resume'
                  ? false
                  : current.isPaused,
            ...(input.action === 'end' ? { endedAt: new Date() } : {}),
          },
        });
      });
    }
    return Response.json({ ok: true });
  });
}
