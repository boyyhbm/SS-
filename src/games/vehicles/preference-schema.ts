import { z } from 'zod';
import { vehicleIdSchema, DEFAULT_VEHICLE } from './config';
export const garageSettingsSchema = z
  .object({ vehicleId: vehicleIdSchema, paint: z.enum(['silver', 'violet', 'cyan']) })
  .strict();
export const defaultGarageSettings = { vehicleId: DEFAULT_VEHICLE, paint: 'silver' as const };
