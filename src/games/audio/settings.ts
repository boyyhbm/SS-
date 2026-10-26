'use client';
import { create } from 'zustand';
import { audioSettingsSchema, defaultAudioSettings, type AudioSettings } from './config';
let version = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
let saving = false,
  queued = false;
interface Store {
  settings: AudioSettings;
  error: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  change: (patch: Partial<AudioSettings>) => void;
  flush: () => Promise<void>;
}
export const useGameAudioSettings = create<Store>((set, get) => ({
  settings: { ...defaultAudioSettings },
  error: false,
  loaded: false,
  async load() {
    const current = version;
    try {
      const r = await fetch('/api/game-audio', { cache: 'no-store' });
      if (!r.ok) throw Error();
      const settings = audioSettingsSchema.parse(await r.json());
      if (version === current) set({ settings, error: false });
      set({ loaded: true });
    } catch {
      set({ loaded: true, error: true });
    }
  },
  change(patch) {
    const settings = audioSettingsSchema.parse({ ...get().settings, ...patch });
    version++;
    set({ settings, error: false });
    queued = true;
    clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), 400);
  },
  async flush() {
    clearTimeout(timer);
    if (saving) return;
    saving = true;
    try {
      while (queued) {
        queued = false;
        const value = get().settings;
        const r = await fetch('/api/game-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          keepalive: true,
        });
        if (!r.ok) throw Error();
      }
    } catch {
      set({ error: true });
    } finally {
      saving = false;
    }
  },
}));
