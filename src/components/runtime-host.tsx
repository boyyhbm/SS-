'use client';
import Link from 'next/link';
import { registeredPlayers, type GameRuntimeContext } from '@/games/players';
import { dictionary } from '@/lib/i18n';
export function GameRuntimeHost({
  runtimeKey,
  ...context
}: GameRuntimeContext & { runtimeKey: string }) {
  const Player = registeredPlayers[runtimeKey];
  if (!Player) {
    const text = dictionary[context.language];
    return (
      <div className="system-message">
        <h1>{text.gameUnavailable}</h1>
        <Link className="button primary" href="/library">
          {text.library}
        </Link>
      </div>
    );
  }
  return <Player key={context.accountId + ':' + context.gameId} {...context} />;
}
