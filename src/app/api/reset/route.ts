import { readJson } from '@/lib/security';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { passwordSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/password';
import { api, assertSameOrigin, ApiError, rateLimit, clientKey } from '@/lib/security';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    await rateLimit(`reset:${clientKey(request)}`, 15);
    const { token, password } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema })
      .parse(await readJson(request));
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      const found = await tx.passwordResetToken.findFirst({
        where: { tokenHash, expiresAt: { gt: new Date() } },
      });
      if (!found) throw new ApiError(400, 'resetExpired');
      const consumed = await tx.passwordResetToken.deleteMany({ where: { id: found.id } });
      if (consumed.count !== 1) throw new ApiError(400, 'resetExpired');
      await tx.user.update({
        where: { id: found.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId: found.userId } });
    });
    return Response.json({ ok: true });
  });
}
