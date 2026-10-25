import { readJson } from '@/lib/security';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { sendRecoveryEmail } from '@/lib/mail';
import { db } from '@/lib/db';
import { api, assertSameOrigin, rateLimit, clientKey, ApiError } from '@/lib/security';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    if (!process.env.SMTP_URL || !process.env.MAIL_FROM)
      throw new ApiError(503, 'recoveryUnavailable');
    await rateLimit(`recovery:${clientKey(request)}`, 10);
    const { email } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
      })
      .parse(await readJson(request));
    await rateLimit(`recovery-email:${email}`, 3);
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await db.$transaction([
        db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
        db.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 1800000) },
        }),
      ]);
      const url = new URL('/reset', process.env.NEXTAUTH_URL);
      url.searchParams.set('token', token);
      await sendRecoveryEmail(email, url.toString());
    }
    return Response.json({ ok: true });
  });
}
