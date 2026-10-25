import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import catalog from './catalog.snapshot.json' with { type: 'json' };
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
async function main() {
  // Public catalog only: retain original IDs, artwork and dates when creating a
  // fresh database. Existing rows and every personal library remain untouched.
  for (const game of catalog)
    await db.game.upsert({
      where: { slug: game.slug },
      create: {
        ...game,
        status: z.enum(['AVAILABLE', 'COMING_SOON']).parse(game.status),
        createdAt: new Date(game.createdAt),
        updatedAt: new Date(game.updatedAt),
      },
      update: {},
    });
  console.log('Catalog seeded. Existing edits and user libraries preserved.');
}
main().finally(() => db.$disconnect());
