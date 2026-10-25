'use client';
import { create } from 'zustand';
import type { ControllerConfig } from './profiles';
import { defaultConfig } from './profiles';
import { nexusInput } from './manager';
export interface ControllerProfileDTO {
  id: string;
  name: string;
  deviceKey: string | null;
  config: ControllerConfig;
}
interface ControllerStore {
  userId: string | null;
  profiles: ControllerProfileDTO[];
  activeId: string | null;
  loaded: boolean;
  setAccount: (data: {
    userId: string | null;
    profiles: ControllerProfileDTO[];
    activeId: string | null;
  }) => void;
}
export const useControllers = create<ControllerStore>((set, get) => ({
  userId: null,
  profiles: [],
  activeId: null,
  loaded: false,
  setAccount: (data) => {
    const previous = get();
    const keepDraft =
      !previous.activeId &&
      !data.activeId &&
      (previous.userId === data.userId ||
        (previous.userId === null && data.userId !== null && data.profiles.length === 0));
    const config = keepDraft ? nexusInput.getSnapshot().config : defaultConfig();
    set({ ...data, loaded: true });
    const profile = data.profiles.find((p) => p.id === data.activeId);
    nexusInput.setConfig(profile?.config ?? config);
  },
}));
let loadSequence = 0;
export async function loadControllers(force = false) {
  const sequence = ++loadSequence;
  const response = await fetch('/api/controllers', { cache: 'no-store' });
  if (sequence !== loadSequence) return;
  if (response.status === 401) {
    if (!useControllers.getState().loaded || useControllers.getState().userId)
      useControllers.getState().setAccount({ userId: null, profiles: [], activeId: null });
    return;
  }
  if (!response.ok) throw Error('controllerLoad');
  const data = await response.json();
  if (
    force ||
    !useControllers.getState().loaded ||
    data.userId !== useControllers.getState().userId
  )
    useControllers.getState().setAccount(data);
  return data;
}
