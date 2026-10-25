import { requireAdmin } from '@/lib/auth';
import { api } from '@/lib/security';
import { realtimeRequest } from '@/lib/multiplayer-server';
export async function GET() {
  return api(async () => {
    const user = await requireAdmin();
    return Response.json(await realtimeRequest(user, { action: 'metrics' }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
