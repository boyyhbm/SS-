import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isPlayable } from '@/games/registry';
import { multiplayerAdapters } from '@/multiplayer/adapters';
import { OnlinePlayer } from '@/components/online-player';
export default async function OnlinePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ room?: string; party?: string }>;
}) {
  const { slug } = await params,
    query = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/online/${slug}`)}`);
  const entry = await db.userLibrary.findFirst({
    where: { userId: user.id, game: { slug } },
    include: { game: true },
  });
  if (
    !entry ||
    !isPlayable(entry.game) ||
    !entry.game.runtimeKey ||
    !multiplayerAdapters[entry.game.runtimeKey]?.capabilities.onlineMultiplayer
  )
    notFound();
  return (
    <OnlinePlayer
      gameId={entry.gameId}
      slug={slug}
      title={entry.game.title}
      userId={user.id}
      language={user.settings?.language === 'en' ? 'en' : 'ru'}
      initialRoom={query.room?.slice(0, 64)}
      partySearch={query.party === '1'}
    />
  );
}
