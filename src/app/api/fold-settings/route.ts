import { requireUser } from '@/lib/auth';
import { api, ApiError, assertSameOrigin, readJson, rateLimit } from '@/lib/security';
import { db } from '@/lib/db';
import {
  forgeWriteSchema,
  legacyForgeSettingsSchema,
  readForgeSettings,
} from '@/games/fold/settings';
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
      db.gameSave.findMany({
        where: {
          userId: u.id,
          gameId: e.gameId,
          saveKey: { in: ['forge-settings-v1', 'forge-settings-v2'] },
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
    const stored = readForgeSettings(Object.fromEntries(save.map((s) => [s.saveKey, s.saveData])));
    return Response.json(
      {
        userId: u.id,
        settings: stored.settings,
        revision: stored.revision,
        updatedAt: stored.updatedAt,
        lastMutationId: stored.lastMutationId,
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
      body = await readJson(request);
    const legacy = legacyForgeSettingsSchema.safeParse(body);
    if (legacy.success) {
      // Existing v0.1 tabs can still save their old slot. They cannot overwrite
      // the versioned configuration adopted by the new runtime.
      await db.gameSave.upsert({
        where: {
          userId_gameId_saveKey: { userId: u.id, gameId: e.gameId, saveKey: 'forge-settings-v1' },
        },
        create: {
          userId: u.id,
          gameId: e.gameId,
          saveKey: 'forge-settings-v1',
          saveData: legacy.data,
        },
        update: { saveData: legacy.data },
      });
      return Response.json({ ok: true, legacy: true });
    }
    const input = forgeWriteSchema.parse(body);
    if (input.ownerId !== u.id) throw new ApiError(403, 'settingsOwnerChanged');
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR UPDATE`;
      const saved = await tx.gameSave.findMany({
        where: {
          userId: u.id,
          gameId: e.gameId,
          saveKey: { in: ['forge-settings-v1', 'forge-settings-v2'] },
        },
      });
      const current = readForgeSettings(
        Object.fromEntries(saved.map((s) => [s.saveKey, s.saveData])),
      );
      if (current.lastMutationId === input.mutationId) return { conflict: false, ...current };
      if (current.revision !== input.expectedRevision) return { conflict: true, ...current };
      const record = {
        version: 2 as const,
        revision: current.revision + 1,
        settings: input.settings,
        updatedAt: new Date().toISOString(),
        lastMutationId: input.mutationId,
      };
      await tx.gameSave.upsert({
        where: {
          userId_gameId_saveKey: { userId: u.id, gameId: e.gameId, saveKey: 'forge-settings-v2' },
        },
        create: { userId: u.id, gameId: e.gameId, saveKey: 'forge-settings-v2', saveData: record },
        update: { saveData: record },
      });
      return { conflict: false, ...record };
    });
    return Response.json(
      { ok: !result.conflict, userId: u.id, ...result },
      { status: result.conflict ? 409 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
