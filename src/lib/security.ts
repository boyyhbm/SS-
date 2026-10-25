import { createHash } from 'node:crypto';
import { db } from './db';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.NEXTAUTH_URL ?? 'http://localhost:3000').origin;
  if (origin !== expected) throw new ApiError(403, 'requestRejected');
}
export async function readLimitedBody(request: Request, limit = 32768) {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new ApiError(413, 'invalidInput');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalidInput');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new ApiError(413, 'invalidInput');
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
export async function readJson(request: Request): Promise<unknown> {
  const body = await readLimitedBody(request);
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new ApiError(400, 'invalidInput');
  }
}
export async function rateLimit(key: string, limit = 10, windowSeconds = 900) {
  const digest = createHash('sha256').update(key).digest('hex');
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${digest}, 1, NOW() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimit"."expiresAt" < NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
    "expiresAt" = CASE WHEN "RateLimit"."expiresAt" < NOW() THEN NOW() + make_interval(secs => ${windowSeconds}) ELSE "RateLimit"."expiresAt" END RETURNING "count"`;
  if (rows[0].count > limit) throw new ApiError(429, 'tooManyAttempts');
}
export function clientKey(request: Request) {
  return process.env.TRUST_PROXY === 'true'
    ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
    : 'shared';
}
export async function api(handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.name === 'ZodError')
      return Response.json({ error: 'invalidInput' }, { status: 400 });
    // Never include input, credentials, database queries or internal error messages in responses/logs.
    return Response.json({ error: 'serverError' }, { status: 500 });
  }
}
