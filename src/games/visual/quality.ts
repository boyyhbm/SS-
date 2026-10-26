'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type RenderQuality = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'cinematic';
export type RenderTier = Exclude<RenderQuality, 'auto'>;
export const qualityPresets = {
  low: {
    dpr: 0.85,
    bloom: false,
    shadows: false,
    lamps: 0,
    cityDistance: 140,
    reflection: false,
    shadowSize: 0,
    shadowDistance: 28,
    samples: 0,
    ao: false,
    textureSize: 512,
    lodNear: 50,
    lodFar: 140,
    vegetation: 0.25,
    anisotropy: 2,
    particles: 0,
    probeSize: 0,
  },
  medium: {
    dpr: 1.25,
    bloom: true,
    shadows: true,
    lamps: 2,
    cityDistance: 350,
    reflection: false,
    shadowSize: 1024,
    shadowDistance: 44,
    samples: 2,
    ao: false,
    textureSize: 1024,
    lodNear: 65,
    lodFar: 180,
    vegetation: 0.5,
    anisotropy: 4,
    particles: 0.25,
    probeSize: 0,
  },
  high: {
    dpr: 1.5,
    bloom: true,
    shadows: true,
    lamps: 4,
    cityDistance: 480,
    reflection: true,
    shadowSize: 2048,
    shadowDistance: 60,
    samples: 4,
    ao: false,
    textureSize: 2048,
    lodNear: 90,
    lodFar: 240,
    vegetation: 0.8,
    anisotropy: 8,
    particles: 0.5,
    probeSize: 256,
  },
  ultra: {
    dpr: 2,
    bloom: true,
    shadows: true,
    lamps: 6,
    cityDistance: 650,
    reflection: true,
    shadowSize: 4096,
    shadowDistance: 80,
    samples: 4,
    ao: true,
    textureSize: 4096,
    lodNear: 125,
    lodFar: 320,
    vegetation: 1,
    anisotropy: 16,
    particles: 0.75,
    probeSize: 256,
  },
  cinematic: {
    dpr: 2,
    bloom: true,
    shadows: true,
    lamps: 6,
    cityDistance: 800,
    reflection: true,
    shadowSize: 4096,
    shadowDistance: 100,
    samples: 4,
    ao: true,
    textureSize: 4096,
    lodNear: 160,
    lodFar: 400,
    vegetation: 1.25,
    anisotropy: 16,
    particles: 1,
    probeSize: 256,
  },
} as const;
// GPU choice belongs to this device, not another computer signed into the same account.
export const useRenderSettings = create<{
  quality: RenderQuality;
  setQuality: (q: RenderQuality) => void;
  dynamicFov: boolean;
  setDynamicFov: (value: boolean) => void;
  postIntensity: number;
  setPostIntensity: (value: number) => void;
  dynamicResolution: boolean;
  setDynamicResolution: (value: boolean) => void;
}>()(
  persist(
    (set) => ({
      quality: 'auto',
      setQuality: (quality) => set({ quality }),
      dynamicFov: false,
      setDynamicFov: (dynamicFov) => set({ dynamicFov }),
      postIntensity: 0.7,
      setPostIntensity: (value) => set({ postIntensity: Math.max(0, Math.min(1, value)) }),
      dynamicResolution: false,
      setDynamicResolution: (dynamicResolution) => set({ dynamicResolution }),
    }),
    {
      name: 'nexus-render-quality',
    },
  ),
);
