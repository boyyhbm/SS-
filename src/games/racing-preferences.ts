'use client';
import { create } from 'zustand';
import type { RacingLineMode } from './racing-line';
let requestVersion = 0;
export const useRacingPreferences = create<{
  mode: RacingLineMode;
  error: boolean;
  busy: boolean;
  load: () => Promise<void>;
  save: (mode: RacingLineMode) => Promise<void>;
}>((set, get) => ({
  mode: 'corners',
  error: false,
  busy: false,
  async load() {
    const version = ++requestVersion;
    try {
      const r = await fetch('/api/racing-settings', { cache: 'no-store' });
      if (!r.ok) throw Error();
      const s = await r.json();
      if (
        version === requestVersion &&
        !get().busy &&
        ['off', 'corners', 'full'].includes(s.racingLine)
      )
        set({ mode: s.racingLine, error: false });
    } catch {
      set({ error: true });
    }
  },
  async save(mode) {
    if (get().busy) return;
    ++requestVersion;
    const previous = get().mode;
    set({ mode, busy: true, error: false });
    try {
      const r = await fetch('/api/racing-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ racingLine: mode }),
      });
      if (!r.ok) throw Error();
    } catch {
      set({ mode: previous, error: true });
    } finally {
      set({ busy: false });
    }
  },
}));
