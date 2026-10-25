import { notFound } from 'next/navigation';
import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export const dynamic = 'force-dynamic';
export default async function Game({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await consoleData();
  if (!data.games.some((g) => g.slug === slug) && !data.library.some((e) => e.game.slug === slug))
    notFound();
  return <Console key={slug} initialData={data} view="game" slug={slug} />;
}
