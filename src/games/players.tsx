'use client';
import dynamic from 'next/dynamic';
import { z } from 'zod';
import type { ComponentType } from 'react';
import type { Language } from '@/lib/i18n';
export interface GameRuntimeContext {
  gameId: string;
  title: string;
  language: Language;
  initialSaves: Record<string, unknown>;
}
const MidnightPlayer = dynamic(() => import('@/components/game-player').then((m) => m.GamePlayer), {
  ssr: false,
});
function MidnightAdapter({ gameId, title, language, initialSaves }: GameRuntimeContext) {
  const saved = initialSaves['best-lap'];
  const best =
    saved && typeof saved === 'object' && 'seconds' in saved && typeof saved.seconds === 'number'
      ? saved.seconds
      : null;
  const history = z
    .array(z.object({ seconds: z.number().finite(), recordedAt: z.string() }))
    .max(10)
    .safeParse(initialSaves['lap-history']);
  return (
    <MidnightPlayer
      gameId={gameId}
      title={title}
      language={language}
      initialBestLap={best}
      initialHistory={history.success ? history.data : []}
    />
  );
}
// Explicit imports only. Each registered game owns its HUD and result adapter.
export const registeredPlayers: Record<string, ComponentType<GameRuntimeContext>> = {
  'midnight-outlaws': MidnightAdapter,
};
