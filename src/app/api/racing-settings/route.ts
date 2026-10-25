import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { api, assertSameOrigin, readJson, rateLimit } from '@/lib/security';
export async function GET() {
  return api(async () => {
    const user = await requireUser();
    const s = await db.userSettings.findUnique({
      where: { userId: user.id },
      select: { racingLine: true },
    });
    return Response.json(
      { racingLine: s?.racingLine ?? 'corners' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit('racing-preferences:' + user.id, 40, 60);
    const value = z
      .object({ racingLine: z.enum(['off', 'corners', 'full']) })
      .strict()
      .parse(await readJson(request));
    await db.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...value },
      update: value,
    });
    return Response.json(value);
  });
}
