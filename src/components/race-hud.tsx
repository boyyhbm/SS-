'use client';
import { useState } from 'react';
import type { RaceTelemetry } from '@/games/midnight-outlaws';
import { timeLabel } from '@/games/racing-physics';
import { visualText } from '@/games/visual/i18n';
import { useRenderSettings, type RenderQuality } from '@/games/visual/quality';
import { Modal } from './modal';
import { InputGlyph } from './input-system';
const route = Array.from({ length: 97 }, (_, i) => {
  const a = (i / 96) * Math.PI * 2;
  return `${i ? 'L' : 'M'} ${90 + Math.cos(a) * 62} ${65 + Math.sin(a) * 43}`;
}).join(' ');
export function RaceHUD({
  telemetry,
  language,
  online = false,
  mode = 'timeTrial',
  position,
  players,
}: {
  telemetry: RaceTelemetry;
  language: 'ru' | 'en';
  online?: boolean;
  mode?: 'practice' | 'timeTrial';
  position?: number;
  players?: number;
}) {
  const t = (key: Parameters<typeof visualText>[1]) => visualText(language, key),
    speed = Math.round(telemetry.speed * 3.6),
    gear = Math.max(1, Math.min(6, Math.ceil(speed / 38))),
    revs = speed ? Math.min(1, 0.25 + (speed - (gear - 1) * 38) / 45) : 0.17;
  return (
    <div className="race-instruments">
      <div className="race-timing">
        <div>
          <span>
            {t('lap')} <i>{String(telemetry.lap).padStart(2, '0')}</i>
          </span>
          <strong data-testid="lap-time">{timeLabel(telemetry.lapTime)}</strong>
        </div>
        <div>
          <span>{t('best')}</span>
          <strong>{telemetry.bestLap ? timeLabel(telemetry.bestLap) : '—:—.——'}</strong>
        </div>
      </div>
      <div className="race-sector">
        <span>
          {t('checkpoint')}{' '}
          <strong data-testid="checkpoint">{telemetry.nextCheckpoint - 1} / 4</strong>
        </span>
        <div>
          {[1, 2, 3, 4].map((n) => (
            <i
              key={n}
              className={
                telemetry.nextCheckpoint > n
                  ? 'complete'
                  : telemetry.nextCheckpoint === n
                    ? 'next'
                    : ''
              }
            />
          ))}
        </div>
      </div>
      <div className="race-route">
        <svg
          viewBox="0 0 180 135"
          aria-label={language === 'ru' ? 'Схема реальной кольцевой трассы' : 'Actual circuit map'}
        >
          <path
            d="M 5 35 L 172 35 M 26 10 L 26 125 M 7 98 L 173 98 M 154 6 L 154 128"
            stroke="#819793"
            strokeOpacity=".22"
            fill="none"
          />
          <path d={route} stroke="#0c151a" strokeWidth="10" fill="none" />
          <path d={route} stroke="#d6dfda" strokeWidth="3.2" fill="none" />
          {[0, 1, 2, 3].map((i) => {
            const a = (i * Math.PI) / 2;
            return (
              <rect
                key={i}
                x={90 + Math.cos(a) * 62 - 3}
                y={65 + Math.sin(a) * 43 - 3}
                width="6"
                height="6"
                fill={i === telemetry.nextCheckpoint % 4 ? '#dbf879' : '#789394'}
              />
            );
          })}
          <g
            transform={`translate(${90 + (telemetry.x / 95) * 62},${65 + (telemetry.z / 95) * 43}) rotate(${(-telemetry.heading * 180) / Math.PI})`}
          >
            <path
              d="M 0 6 L -4 -4 L 0 -2 L 4 -4 Z"
              fill="#dfff81"
              stroke="#0b141a"
              strokeWidth="1"
            />
          </g>
        </svg>
        <div>
          <span>{t('district')}</span>
          <small>01 / AFTER HOURS</small>
        </div>
      </div>
      <div className="race-speedometer">
        <div className="race-transmission">
          <span>{online ? t('position') : t(mode)}</span>
          <strong>
            {online ? `${position ?? '—'}/${players ?? '—'}` : 'AT'} <i>{gear}</i>
          </strong>
        </div>
        <div className="rpm-scale" aria-label="RPM">
          {Array.from({ length: 24 }, (_, i) => (
            <i key={i} className={`${i / 24 < revs ? 'lit' : ''} ${i > 19 ? 'redline' : ''}`} />
          ))}
        </div>
        <div className="speed-readout">
          <strong data-testid={online ? 'online-speed' : 'speed'}>{speed}</strong>
          <span>{t('speed')}</span>
        </div>
        <div className="nitro-meter">
          <span>
            <InputGlyph action="boost" fallback="SHIFT" /> {t('nitro')}
          </span>
          <div>
            {Array.from({ length: 20 }, (_, i) => (
              <i key={i} className={i / 20 < telemetry.nitro / 100 ? 'charged' : ''} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
export function GraphicsSettings({ language }: { language: 'ru' | 'en' }) {
  const settings = useRenderSettings(),
    [credits, setCredits] = useState(false),
    t = (k: Parameters<typeof visualText>[1]) => visualText(language, k);
  return (
    <>
      <div className="graphics-settings">
        <label>
          {t('graphics')}
          <select
            aria-label={t('graphics')}
            value={settings.quality}
            onChange={(e) => settings.setQuality(e.target.value as RenderQuality)}
          >
            {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
              <option value={q} key={q}>
                {t(q)}
              </option>
            ))}
          </select>
        </label>
        <button className="text-button" onClick={() => setCredits(true)}>
          {t('credits')}
        </button>
      </div>
      {credits && (
        <Modal title={t('credits')} closeLabel={t('close')} onClose={() => setCredits(false)}>
          <div className="asset-credits">
            <p>{t('assetCredit')}</p>
            <p>
              <strong>Car Concept</strong>
              <br />
              Eric Chadwick / Darmstadt Graphics Group GmbH, 2024. CC BY 4.0.{' '}
              {language === 'ru'
                ? 'Исходная концепция: Unity Fan. Удалены эмблема и номер; изменены материалы, подготовлены LOD.'
                : 'Original concept: Unity Fan. Logo and plate removed, LOD and material changes.'}
            </p>
            <p>
              <strong>Amazon Lumberyard Bistro</strong>
              <br />
              Amazon Lumberyard. CC BY 4.0.{' '}
              {language === 'ru'
                ? 'Порт Godot: Logan Preshaw; изменения: John James Gutib (Jamsers). NEXUS восстанавливает материалы, точки опоры зданий, текстуры и LOD. Аудио из источника не используется.'
                : 'Godot port: Logan Preshaw; modifications: John James Gutib (Jamsers). NEXUS reconstructs materials, building pivots, textures and LOD. No source audio is included.'}
            </p>
            <p>
              <strong>Venice Sunset HDRI</strong>
              <br />
              HDRI Haven / Poly Haven, CC0. {language === 'ru' ? 'Зеркало' : 'Mirror'}:
              pmndrs/drei-assets.
            </p>
            <p>
              {language === 'ru'
                ? 'Трасса, PBR-асфальт, свет, интерфейс и эффекты: NEXUS.'
                : 'Track, PBR asphalt, lighting, UI and effects: NEXUS.'}
            </p>
            <a href="/game-assets/manifest.json" target="_blank" rel="noreferrer">
              {language === 'ru' ? 'Источники и сведения об ассетах' : 'Asset sources and details'}
            </a>
            <a href="/game-assets/licenses/CC-BY-4.0.txt" target="_blank" rel="noreferrer">
              Creative Commons Attribution 4.0
            </a>
          </div>
        </Modal>
      )}
    </>
  );
}
