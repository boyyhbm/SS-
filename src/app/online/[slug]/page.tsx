import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isPlayable } from '@/games/registry';
import { multiplayerCapabilities } from '@/multiplayer/adapters';
import { OnlinePlayer } from '@/components/online-player';
import { FoldPlayer } from '@/components/fold-player';
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
    !multiplayerCapabilities(entry.game.runtimeKey)?.onlineMultiplayer
  )
    notFound();
  if (entry.game.runtimeKey === 'fold-zero') {
    const settings = await db.gameSave.findUnique({
      where: {
        userId_gameId_saveKey: {
          userId: user.id,
          gameId: entry.gameId,
          saveKey: 'forge-settings-v1',
        },
      },
    });
    return (
      <FoldPlayer
        accountId={user.id}
        gameId={entry.gameId}
        title={entry.game.title}
        language={user.settings?.language === 'en' ? 'en' : 'ru'}
        initialSaves={settings ? { 'forge-settings-v1': settings.saveData } : {}}
        initialRoom={query.room?.slice(0, 64)}
      />
    );
  }
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
