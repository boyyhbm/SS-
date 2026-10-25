import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const games = [
  {
    slug: 'midnight-outlaws',
    title: 'MIDNIGHT OUTLAWS',
    genre: 'racing',
    description:
      'Город засыпает. Твой двигатель — нет. Ночная трасса, неоновый горизонт и один идеальный круг. Оригинальный аркадный прототип: набери скорость, поймай апекс и оставь свой лучший результат.',
    descriptionEn:
      'The city sleeps. Your engine doesn’t. A night circuit, a neon horizon and one perfect lap. An original arcade prototype: build speed, find the apex and set your best time.',
    cover: '/art/midnight-cover.svg',
    banner: '/art/midnight-banner.svg',
    runtimeKey: 'midnight-outlaws',
    status: 'AVAILABLE' as const,
  },
  {
    slug: 'orbital-silence',
    title: 'ORBITAL SILENCE',
    genre: 'exploration',
    description:
      'За пределами знакомых созвездий. Концепция будущей космической экспедиции — игра в разработке и пока недоступна для запуска.',
    descriptionEn:
      'Beyond familiar constellations. A concept for a future space expedition — in development and not yet playable.',
    cover: '/art/orbital-cover.svg',
    banner: '/art/orbital-banner.svg',
    runtimeKey: null,
    status: 'COMING_SOON' as const,
  },
  {
    slug: 'evergreen',
    title: 'EVERGREEN',
    genre: 'adventure',
    description:
      'У каждого леса есть память. Концепция атмосферного приключения в мире древних деревьев. Игра в разработке.',
    descriptionEn:
      'Every forest remembers. A concept for an atmospheric adventure among ancient trees. In development.',
    cover: '/art/evergreen-cover.svg',
    banner: '/art/evergreen-banner.svg',
    runtimeKey: null,
    status: 'COMING_SOON' as const,
  },
  {
    slug: 'echoes-of-light',
    title: 'ECHOES OF LIGHT',
    genre: 'puzzle',
    description:
      'Найди порядок в отражениях. Концепция пространственной головоломки о свете и тени. Игра в разработке.',
    descriptionEn:
      'Find order in reflections. A concept for a spatial puzzle about light and shadow. In development.',
    cover: '/art/echoes-cover.svg',
    banner: '/art/echoes-banner.svg',
    runtimeKey: null,
    status: 'COMING_SOON' as const,
  },
];
async function main() {
  for (const [index, game] of games.entries())
    await db.game.upsert({
      where: { slug: game.slug },
      create: {
        ...game,
        version: game.runtimeKey ? '0.1.0' : '0.0.0',
        sortOrder: index,
        published: true,
        screenshots: game.runtimeKey ? ['/art/midnight-gameplay.webp'] : [],
      },
      update: {},
    });
  console.log('Catalog seeded. Existing edits and user libraries preserved.');
}
main().finally(() => db.$disconnect());
