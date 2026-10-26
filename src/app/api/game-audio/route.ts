import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { api, assertSameOrigin, readJson, rateLimit } from '@/lib/security';
import { audioSettingsSchema, defaultAudioSettings } from '@/games/audio/config';
const saveKey = 'game-audio-v1';
async function game() {
  return db.game.findUniqueOrThrow({ where: { slug: 'midnight-outlaws' }, select: { id: true } });
}
export async function GET() {
  return api(async () => {
    const user = await requireUser(),
      g = await game();
    const save = await db.gameSave.findUnique({
      where: { userId_gameId_saveKey: { userId: user.id, gameId: g.id, saveKey } },
    });
    const parsed = audioSettingsSchema.safeParse(save?.saveData);
    return Response.json(parsed.success ? parsed.data : defaultAudioSettings, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit('game-audio:' + user.id, 100, 60);
    const settings = audioSettingsSchema.parse(await readJson(request)),
      g = await game();
    await db.gameSave.upsert({
      where: { userId_gameId_saveKey: { userId: user.id, gameId: g.id, saveKey } },
      create: { userId: user.id, gameId: g.id, saveKey, saveData: settings },
      update: { saveData: settings },
    });
    return Response.json(settings);
  });
}
