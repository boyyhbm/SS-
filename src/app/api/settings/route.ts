import { savePreferences } from '@/lib/preferences';
import { api, assertSameOrigin, readJson } from '@/lib/security';
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    await savePreferences(await readJson(request));
    return Response.json({ ok: true });
  });
}
