import { z } from 'zod';
export const forgeSettingsSchema = z
  .object({
    quality: z.enum(['auto', 'competitive', 'low', 'medium', 'high', 'ultra']),
    mouseSensitivity: z.number().finite().min(0.1).max(3),
    aimSensitivity: z.number().finite().min(0.2).max(3),
    responseCurve: z.number().finite().min(1).max(2.5),
    invertY: z.boolean(),
    headBob: z.boolean(),
    master: z.number().finite().min(0).max(1),
    weapons: z.number().finite().min(0).max(1),
    environment: z.number().finite().min(0).max(1),
    effects: z.number().finite().min(0).max(1),
  })
  .strict();
export type ForgeSettings = z.infer<typeof forgeSettingsSchema>;
export const defaultForgeSettings: ForgeSettings = {
  quality: 'auto',
  mouseSensitivity: 1,
  aimSensitivity: 1,
  responseCurve: 1.5,
  invertY: false,
  headBob: false,
  master: 0.65,
  weapons: 0.8,
  environment: 0.4,
  effects: 0.7,
};
