import { redirect, notFound } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isPlayable } from '@/games/registry';
import { GameRuntimeHost } from '@/components/runtime-host';
export default async function Play({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/play/${slug}`)}`);
  const entry = await db.userLibrary.findFirst({
    where: { userId: user.id, game: { slug } },
    include: { game: true },
  });
  if (!entry || !isPlayable(entry.game)) notFound();
  const saves = await db.gameSave.findMany({ where: { userId: user.id, gameId: entry.gameId } });
  return (
    <GameRuntimeHost
      accountId={user.id}
      gameId={entry.gameId}
      title={entry.game.title}
      language={user.settings?.language === 'en' ? 'en' : 'ru'}
      runtimeKey={entry.game.runtimeKey!}
      initialSaves={Object.fromEntries(saves.map((save) => [save.saveKey, save.saveData]))}
    />
  );
}
