import { readJson } from '@/lib/security';
import { db } from '@/lib/db';
import { registrationSchema } from '@/lib/validation';
import { api, assertSameOrigin, rateLimit, clientKey, ApiError } from '@/lib/security';
import { hashPassword } from '@/lib/password';
import { Prisma } from '@prisma/client';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    await rateLimit(`register:${clientKey(request)}`, 30);
    const parsed = registrationSchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message === 'passwordMismatch'
          ? 'passwordMismatch'
          : 'registrationRules',
      );
    const { username, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      await db.user.create({ data: { username, email, passwordHash, settings: { create: {} } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await db.user.findUnique({ where: { username }, select: { id: true } });
        throw new ApiError(409, existing ? 'usernameTaken' : 'emailTaken');
      }
      throw error;
    }
    return Response.json({ ok: true }, { status: 201 });
  });
}
