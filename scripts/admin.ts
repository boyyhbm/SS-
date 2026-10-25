import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createInterface } from 'node:readline/promises';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
async function main() {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const email = (process.argv[2] ?? (await input.question('Existing account email: ')))
    .trim()
    .toLowerCase();
  input.close();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error('Register an account through NEXUS first.');
  await db.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  console.log('Account promoted to ADMIN.');
}
main()
  .catch(() => {
    console.error('Could not promote account. Register it first and check DATABASE_URL.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
