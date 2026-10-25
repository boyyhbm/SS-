import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
const instanceId = randomUUID();

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    // Detect an unmigrated database as well as an unavailable database.
    await db.game.count();
    return Response.json(
      { ok: true, service: 'nexus-web', instanceId },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch {
    return Response.json(
      { ok: false, service: 'nexus-web' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
