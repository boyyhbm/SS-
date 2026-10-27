import { requireUser } from '@/lib/auth';
import { api, ApiError, assertSameOrigin, readJson, rateLimit } from '@/lib/security';
import { db } from '@/lib/db';
import { defaultForgeSettings, forgeSettingsSchema } from '@/games/fold/settings';
async function entry(userId: string) {
  const e = await db.userLibrary.findFirst({
    where: { userId, game: { slug: 'fold-zero', runtimeKey: 'fold-zero', published: true } },
    select: { gameId: true },
  });
  if (!e) throw new ApiError(403, 'gameUnavailable');
  return e;
}
export async function GET() {
  return api(async () => {
    const u = await requireUser(),
      e = await entry(u.id);
    const [save, history, rating] = await Promise.all([
      db.gameSave.findUnique({
        where: {
          userId_gameId_saveKey: { userId: u.id, gameId: e.gameId, saveKey: 'forge-settings-v1' },
        },
      }),
      db.matchParticipant.findMany({
        where: { userId: u.id, match: { gameId: e.gameId, status: 'FINISHED' } },
        include: { result: true, match: { select: { startedAt: true } } },
        orderBy: { match: { startedAt: 'desc' } },
        take: 10,
      }),
      db.playerRating.findUnique({
        where: { userId_gameId_mode: { userId: u.id, gameId: e.gameId, mode: 'duel' } },
      }),
    ]);
    const parsed = forgeSettingsSchema.safeParse(save?.saveData);
    return Response.json(
      {
        userId: u.id,
        settings: parsed.success ? parsed.data : defaultForgeSettings,
        history: history.map((h) => ({
          matchId: h.matchId,
          startedAt: h.match.startedAt,
          result: h.result,
        })),
        stats: { matches: rating?.races ?? 0, wins: rating?.wins ?? 0 },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const u = await requireUser();
    await rateLimit(`forge-settings:${u.id}`, 30, 60);
    const e = await entry(u.id),
      value = forgeSettingsSchema.parse(await readJson(request));
    await db.gameSave.upsert({
      where: {
        userId_gameId_saveKey: { userId: u.id, gameId: e.gameId, saveKey: 'forge-settings-v1' },
      },
      create: { userId: u.id, gameId: e.gameId, saveKey: 'forge-settings-v1', saveData: value },
      update: { saveData: value },
    });
    return Response.json({ ok: true });
  });
}
