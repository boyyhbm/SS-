'use client';
import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useGameAudioSettings } from '@/games/audio/settings';
import { audioText } from '@/games/audio/config';
import { inspectGameAudio, resumeGameAudio, type GameAudioStatus } from '@/games/audio/engine';

export function GameAudioSettings({ language }: { language: 'ru' | 'en' }) {
  const store = useGameAudioSettings(),
    t = audioText[language];
  const [status, setStatus] = useState<GameAudioStatus>('locked');
  useEffect(() => {
    setStatus(inspectGameAudio()[0]?.status ?? 'locked');
    const changed = (e: Event) => setStatus((e as CustomEvent<GameAudioStatus>).detail);
    window.addEventListener('nexus-game-audio-status', changed);
    return () => window.removeEventListener('nexus-game-audio-status', changed);
  }, []);
  return (
    <details className="game-audio-settings" data-audio-status={status}>
      <summary tabIndex={0}>
        <Volume2 size={16} />
        {t.title}
      </summary>
      <div className="audio-settings-grid">
        {(['master', 'engine', 'tires', 'environment', 'effects', 'music'] as const).map((key) => (
          <label key={key}>
            {t[key]}
            <output>{Math.round(store.settings[key] * 100)}%</output>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              aria-label={t[key]}
              value={store.settings[key]}
              onChange={(e) => store.change({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <label className="audio-mute">
        <VolumeX size={15} />
        <input
          type="checkbox"
          checked={store.settings.muted}
          onChange={(e) => store.change({ muted: e.target.checked })}
        />
        {t.muted}
      </label>
      {status !== 'running' && (
        <div className="audio-status" role="status">
          <span>
            {status === 'locked' ? t.locked : status === 'suspended' ? t.suspended : t.unavailable}
          </span>
          {status !== 'unavailable' && (
            <button type="button" className="text-button" onClick={resumeGameAudio}>
              {t.enable}
            </button>
          )}
        </div>
      )}
      {store.error && <p role="status">{t.saveError}</p>}
    </details>
  );
}
