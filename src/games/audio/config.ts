import { z } from 'zod';

export const audioSettingsSchema = z
  .object({
    master: z.number().finite().min(0).max(1),
    engine: z.number().finite().min(0).max(1),
    tires: z.number().finite().min(0).max(1),
    environment: z.number().finite().min(0).max(1),
    effects: z.number().finite().min(0).max(1),
    music: z.number().finite().min(0).max(1),
    muted: z.boolean(),
  })
  .strict();
export type AudioSettings = z.infer<typeof audioSettingsSchema>;
export const defaultAudioSettings: AudioSettings = {
  master: 0.7,
  engine: 0.72,
  tires: 0.55,
  environment: 0.28,
  effects: 0.65,
  music: 0,
  muted: false,
};
export type AudioEnvironment = 'city' | 'industrial' | 'mountain' | 'circuit' | 'coast';
export interface EngineAudioProfile {
  id: string;
  cylinders: number;
  idleRPM: number;
  maxRPM: number;
  gearRatios: readonly number[];
  finalDrive: number;
  wheelRadius: number;
  exhaust: number;
  mechanical: number;
  turbo: number;
}
export const conceptAudioProfile: EngineAudioProfile = {
  id: 'nexus-v6',
  cylinders: 6,
  idleRPM: 850,
  maxRPM: 7600,
  gearRatios: [3.3, 2.15, 1.58, 1.22, 0.96, 0.78],
  finalDrive: 3.6,
  wheelRadius: 0.34,
  exhaust: 0.72,
  mechanical: 0.4,
  turbo: 0.32,
};
export const audioText = {
  ru: {
    title: 'Звук',
    master: 'Общая громкость',
    engine: 'Двигатель',
    tires: 'Шины',
    environment: 'Окружение',
    effects: 'Эффекты',
    music: 'Музыка',
    muted: 'Выключить весь звук',
    enable: 'Включить звук',
    locked: 'Для включения звука нажмите кнопку',
    unavailable: 'Звук недоступен в этом браузере',
    saveError: 'Не удалось сохранить громкость',
    running: 'Звук включён',
    suspended: 'Звук приостановлен браузером',
  },
  en: {
    title: 'Audio',
    master: 'Master volume',
    engine: 'Engine',
    tires: 'Tires',
    environment: 'Environment',
    effects: 'Effects',
    music: 'Music',
    muted: 'Mute all audio',
    enable: 'Enable audio',
    locked: 'Press the button to enable audio',
    unavailable: 'Audio is unavailable in this browser',
    saveError: 'Could not save volume',
    running: 'Audio enabled',
    suspended: 'Audio suspended by browser',
  },
} as const;
