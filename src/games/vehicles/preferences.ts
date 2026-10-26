'use client';
import { create } from 'zustand';
import { z } from 'zod';
import { DEFAULT_VEHICLE, type VehicleId } from './config';
export { garageSettingsSchema as garagePreferenceSchema } from './preference-schema';
import { garageSettingsSchema as garagePreferenceSchema } from './preference-schema';
export type GaragePreference = z.infer<typeof garagePreferenceSchema>;
let revision = 0;
export const useGaragePreference = create<{
  value: GaragePreference;
  busy: boolean;
  error: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  save: (vehicleId: VehicleId, paint?: GaragePreference['paint']) => Promise<boolean>;
}>((set, get) => ({
  value: { vehicleId: DEFAULT_VEHICLE, paint: 'silver' },
  busy: false,
  error: false,
  loaded: false,
  async load() {
    const version = revision;
    try {
      const r = await fetch('/api/garage', { cache: 'no-store' });
      if (!r.ok) throw Error();
      const value = garagePreferenceSchema.parse(await r.json());
      if (version === revision) set({ value, error: false });
      set({ loaded: true });
    } catch {
      set({ error: true, loaded: true });
    }
  },
  async save(vehicleId, paint = get().value.paint) {
    if (get().busy) return false;
    revision++;
    const old = get().value;
    const value = garagePreferenceSchema.parse({ vehicleId, paint });
    set({ value, busy: true, error: false });
    try {
      const r = await fetch('/api/garage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!r.ok) throw Error();
      set({ busy: false });
      return true;
    } catch {
      set({ value: old, busy: false, error: true });
      return false;
    }
  },
}));
