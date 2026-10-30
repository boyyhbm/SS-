'use client';
import type { ForgeSettings } from '@/games/fold/settings';

// Uses only the local player's speed/shot feedback. It never queries targets.
export function ForgeCrosshair({
  settings: s,
  spread = 0,
  hit = false,
  preview = false,
}: {
  settings: ForgeSettings['crosshair'];
  spread?: number;
  hit?: boolean;
  preview?: boolean;
}) {
  const gap = s.gap + (s.dynamic ? Math.min(8, Math.max(0, spread)) : 0);
  const line = {
    fill: s.color,
    stroke: s.outline ? '#142039' : 'none',
    strokeWidth: s.outline ? 1.3 : 0,
    paintOrder: 'stroke' as const,
  };
  return (
    <svg
      className={preview ? 'forge-reticle-preview' : 'forge-reticle'}
      viewBox="-48 -48 96 96"
      width="96"
      height="96"
      aria-hidden="true"
      data-testid={preview ? 'crosshair-preview' : 'game-crosshair'}
      style={{ opacity: s.opacity }}
    >
      <g {...line}>
        <rect x={gap} y={-s.thickness / 2} width={s.size} height={s.thickness} />
        <rect x={-gap - s.size} y={-s.thickness / 2} width={s.size} height={s.thickness} />
        <rect x={-s.thickness / 2} y={gap} width={s.thickness} height={s.size} />
        <rect x={-s.thickness / 2} y={-gap - s.size} width={s.thickness} height={s.size} />
        {s.dot && <circle r={Math.max(1, s.thickness * 0.65)} />}
      </g>
      {hit && (
        <path d="M-13-13-8-8M13-13 8-8M-13 13-8 8M13 13 8 8" stroke="#ff9759" strokeWidth="2" />
      )}
    </svg>
  );
}
