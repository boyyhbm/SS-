import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
const claimsSchema = z.object({
  sub: z.string().min(1).max(64),
  ver: z.number().int(),
  kind: z.enum(['control', 'seat']),
  roomId: z.string().max(64).optional(),
  exp: z.number(),
  iat: z.number(),
  jti: z.string(),
  aud: z.literal('nexus-realtime'),
});
export type ConnectionClaims = z.infer<typeof claimsSchema>;
function secret() {
  const value = process.env.MULTIPLAYER_SECRET;
  if (!value || value.length < 64)
    throw new Error('MULTIPLAYER_SECRET must have at least 64 characters');
  return value;
}
export function signConnectionToken(
  data: Pick<ConnectionClaims, 'sub' | 'ver' | 'kind'> & { roomId?: string },
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({
      ...data,
      iat: now,
      exp: now + 45000,
      jti: randomUUID(),
      aud: 'nexus-realtime',
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function verifyConnectionToken(
  token: unknown,
  kind: ConnectionClaims['kind'],
  now = Date.now(),
) {
  if (typeof token !== 'string' || token.length > 2048) throw new Error('Unauthorized');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Unauthorized');
  const expected = createHmac('sha256', secret()).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied))
    throw new Error('Unauthorized');
  const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString()));
  if (
    claims.kind !== kind ||
    claims.exp <= now ||
    claims.iat > now + 2000 ||
    claims.exp - claims.iat > 45000
  )
    throw new Error('Unauthorized');
  return claims;
}
