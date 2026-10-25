import 'dotenv/config';
import { db } from '../src/lib/db';
const prefix = process.argv[2];
const ids = process.argv.slice(3);
if (
  !['railway', 'render'].includes(process.env.NEXUS_DEPLOYMENT ?? '') ||
  !/^release_[a-f0-9]{8}$/.test(prefix ?? '') ||
  ids.length < 1 ||
  ids.length > 2 ||
  ids.some((id) => !/^[a-z0-9]{16,64}$/.test(id))
)
  throw Error('Only an explicitly named production-check fixture can be removed');
try {
  const names = [prefix + '_a', prefix + '_b'];
  const users = await db.user.findMany({ where: { id: { in: ids }, username: { in: names } } });
  if (users.length !== ids.length)
    throw Error('Every fixture ID must match the private verification ledger');
  if (
    users.some(
      (u) =>
        u.role !== 'USER' ||
        u.email !== `${u.username}@example.test` ||
        Date.now() - u.createdAt.getTime() > 86400000,
    )
  )
    throw Error('Fixture identity check failed');
  const removed = await db.$transaction(async (tx) => {
    await tx.multiplayerMatch.deleteMany({
      where: { participants: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
    });
    const result = await tx.user.deleteMany({ where: { id: { in: ids }, role: 'USER' } });
    if (result.count !== users.length)
      throw Error('Fixture identity changed; transaction rolled back');
    return result.count;
  });
  console.log(`Removed ${removed} explicitly identified verification accounts.`);
} finally {
  await db.$disconnect();
}
