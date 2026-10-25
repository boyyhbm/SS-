import { requireUser } from '@/lib/auth';
import { api, assertSameOrigin, rateLimit, readJson } from '@/lib/security';
import { realtimeRequest } from '@/lib/multiplayer-server';
import { multiplayerActionSchema } from '@/multiplayer/contracts';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`multiplayer:${user.id}`, 120, 60);
    const body = multiplayerActionSchema.parse(await readJson(request));
    return Response.json(await realtimeRequest(user, body), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
export async function GET() {
  return api(async () => {
    const user = await requireUser();
    return Response.json(await realtimeRequest(user, { action: 'status' }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
