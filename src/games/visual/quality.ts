'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type RenderQuality = 'auto' | 'low' | 'medium' | 'high';
export type RenderTier = Exclude<RenderQuality, 'auto'>;
export const qualityPresets = {
  low: { dpr: 0.85, bloom: false, shadows: false, lamps: 0, cityDistance: 100, reflection: false },
  medium: { dpr: 1.25, bloom: true, shadows: true, lamps: 4, cityDistance: 420, reflection: false },
  high: { dpr: 1.7, bloom: true, shadows: true, lamps: 6, cityDistance: 600, reflection: true },
} as const;
// GPU choice belongs to this device, not another computer signed into the same account.
export const useRenderSettings = create<{
  quality: RenderQuality;
  setQuality: (q: RenderQuality) => void;
}>()(
  persist((set) => ({ quality: 'auto', setQuality: (quality) => set({ quality }) }), {
    name: 'nexus-render-quality',
  }),
);
