import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { api, assertSameOrigin, readJson, rateLimit } from '@/lib/security';
import { garageSettingsSchema, defaultGarageSettings } from '@/games/vehicles/preference-schema';
const saveKey = 'garage-v1';
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
    const parsed = garageSettingsSchema.safeParse(save?.saveData);
    return Response.json(parsed.success ? parsed.data : defaultGarageSettings, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit('garage:' + user.id, 60, 60);
    const settings = garageSettingsSchema.parse(await readJson(request)),
      g = await game();
    await db.gameSave.upsert({
      where: { userId_gameId_saveKey: { userId: user.id, gameId: g.id, saveKey } },
      create: { userId: user.id, gameId: g.id, saveKey, saveData: settings },
      update: { saveData: settings },
    });
    return Response.json(settings);
  });
}
