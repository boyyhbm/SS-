import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

// A complete browser suite creates >30 distinct accounts behind one local address.
// Isolate registration-heavy test groups without weakening the application limit.
export async function isolateRegistrationQuota(db: PrismaClient) {
  if (process.env.NEXUS_E2E_DISPOSABLE_DB !== '1') return;
  const database = new URL(process.env.DATABASE_URL!),
    origin = new URL(process.env.TEST_BASE_URL ?? 'http://localhost:3000');
  const local = (hostname: string) => ['localhost', '127.0.0.1'].includes(hostname);
  const scratch = /^\/nexus_(?:gameplay|underground)_qa_[a-f0-9]{8}$/.test(database.pathname);
  const ciDatabase = process.env.CI === 'true' && database.pathname === '/nexus';
  if (!local(database.hostname) || !local(origin.hostname) || (!scratch && !ciDatabase))
    throw Error('Registration fixture requires an explicitly disposable local database');
  await db.rateLimit.deleteMany({
    where: { key: createHash('sha256').update('register:shared').digest('hex') },
  });
}
