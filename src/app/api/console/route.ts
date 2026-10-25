import { consoleData } from '@/lib/data';
import { api } from '@/lib/security';
export const dynamic = 'force-dynamic';
export async function GET() {
  return api(async () =>
    Response.json(await consoleData(), { headers: { 'Cache-Control': 'no-store' } }),
  );
}
