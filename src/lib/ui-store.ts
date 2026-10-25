'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from './i18n';
interface UIState {
  language: Language;
  sound: boolean;
  reducedMotion: boolean;
  background: boolean;
  setPreferences: (
    values: Partial<Pick<UIState, 'language' | 'sound' | 'reducedMotion' | 'background'>>,
  ) => void;
}
export const useUI = create<UIState>()(
  persist(
    (set) => ({
      language: 'ru',
      sound: false,
      reducedMotion: false,
      background: true,
      setPreferences: (values) => set(values),
    }),
    {
      name: 'nexus-ui',
      partialize: (state) => ({
        language: state.language,
        sound: state.sound,
        reducedMotion: state.reducedMotion,
        background: state.background,
      }),
    },
  ),
);
let audio: AudioContext | undefined;
export function playSound(type: 'focus' | 'confirm' | 'launch' | 'add' = 'focus') {
  if (
    !useUI.getState().sound ||
    (navigator.userActivation && !navigator.userActivation.hasBeenActive)
  )
    return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const frequency = { focus: 420, confirm: 620, launch: 220, add: 780 }[type];
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, audio.currentTime + 0.09);
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.13);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.14);
  } catch {
    /* Audio unavailable: UI remains functional. */
  }
}
