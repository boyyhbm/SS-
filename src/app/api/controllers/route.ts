import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { api, ApiError, assertSameOrigin, readJson, rateLimit } from '@/lib/security';
import { controllerConfigSchema } from '@/input/profiles';
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      id: z.string().max(64).optional(),
      name: z.string().trim().min(2).max(40),
      deviceKey: z
        .string()
        .regex(/^pad_[a-f0-9]+$/)
        .max(32)
        .nullable(),
      config: controllerConfigSchema,
    })
    .strict(),
  z.object({ action: z.enum(['delete', 'activate']), id: z.string().min(1).max(64) }).strict(),
]);
export async function GET() {
  return api(async () => {
    const user = await requireUser();
    return Response.json(
      {
        userId: user.id,
        activeId: user.settings?.controllerProfileId ?? null,
        profiles: await db.controllerProfile.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
        }),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`controllers:${user.id}`, 60, 60);
    const input = schema.parse(await readJson(request));
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
      if (
        input.id &&
        !(await tx.controllerProfile.findFirst({ where: { id: input.id, userId: user.id } }))
      )
        throw new ApiError(403, 'requestRejected');
      if (input.action === 'save') {
        if (!input.id && (await tx.controllerProfile.count({ where: { userId: user.id } })) >= 8)
          throw new ApiError(409, 'profileLimit');
        const profile = input.id
          ? await tx.controllerProfile.update({
              where: { id: input.id },
              data: { name: input.name, deviceKey: input.deviceKey, config: input.config },
            })
          : await tx.controllerProfile.create({
              data: {
                userId: user.id,
                name: input.name,
                deviceKey: input.deviceKey,
                config: input.config,
              },
            });
        await tx.userSettings.upsert({
          where: { userId: user.id },
          create: { userId: user.id, controllerProfileId: profile.id },
          update: { controllerProfileId: profile.id },
        });
        return { id: profile.id };
      }
      if (input.action === 'delete') await tx.controllerProfile.delete({ where: { id: input.id } });
      else
        await tx.userSettings.upsert({
          where: { userId: user.id },
          create: { userId: user.id, controllerProfileId: input.id },
          update: { controllerProfileId: input.id },
        });
      return { ok: true };
    });
    return Response.json(result);
  });
}
