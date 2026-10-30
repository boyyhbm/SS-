import { z } from 'zod';
import { forgeSettingsSchema, readForgeSettings, type ForgeSettings } from './settings';

const remoteSchema = z.object({
  userId: z.string(),
  settings: forgeSettingsSchema,
  revision: z.number().int().min(0),
  lastMutationId: z.uuid().nullable(),
  updatedAt: z.string().nullable(),
});
export type ForgeRemoteSettings = z.infer<typeof remoteSchema>;
const cacheSchema = z
  .object({
    ownerId: z.string(),
    settings: forgeSettingsSchema,
    revision: z.number().int().min(0),
    pending: z.boolean(),
    mutationId: z.uuid().nullable(),
  })
  .strict()
  .refine((v) => !v.pending || v.mutationId !== null);
export type ForgeSyncStatus =
  'loading' | 'cloud' | 'local' | 'saving' | 'conflict' | 'account-changed';
export type ForgeSettingsState = {
  settings: ForgeSettings;
  revision: number;
  status: ForgeSyncStatus;
  ready: boolean;
  cacheAvailable: boolean;
  conflict: ForgeRemoteSettings | null;
};
export interface ForgeSettingsIO {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  online: (callback: () => void) => () => void;
}
const browserIO = (): ForgeSettingsIO => ({
  read: (key) => localStorage.getItem(key),
  write: (key, value) => localStorage.setItem(key, value),
  request: (url, init) => fetch(url, init),
  online: (callback) => {
    window.addEventListener('online', callback);
    return () => window.removeEventListener('online', callback);
  },
});

// An account owns one versioned cloud record. The device cache is partitioned
// by the same immutable account ID. Revision checks and mutation IDs protect
// both concurrent edits and retry-after-lost-response; no last-writer guessing.
export class ForgeSettingsStore {
  private state: ForgeSettingsState;
  private serverState: ForgeSettingsState;
  private listeners = new Set<() => void>();
  private io: ForgeSettingsIO | null;
  private active = false;
  private writing = false;
  private generation = 0;
  private refreshed = false;
  private activity = 0;
  private abort = new AbortController();
  private pending: { settings: ForgeSettings; baseRevision: number; mutationId: string } | null =
    null;
  readonly cacheKey: string;
  constructor(
    readonly ownerId: string,
    initialSaves: Record<string, unknown>,
    io?: ForgeSettingsIO,
  ) {
    const initial = readForgeSettings(initialSaves);
    this.state = {
      settings: initial.settings,
      revision: initial.revision,
      status: 'loading',
      ready: false,
      cacheAvailable: true,
      conflict: null,
    };
    this.serverState = this.state;
    this.cacheKey = 'nexus:forge:settings:v2:' + ownerId;
    this.io = io ?? null;
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => this.serverState;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private emit(patch: Partial<ForgeSettingsState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  start() {
    this.active = true;
    this.generation++;
    this.refreshed = false;
    this.writing = false;
    this.abort = new AbortController();
    this.io ??= browserIO();
    try {
      const text = this.io.read(this.cacheKey);
      const parsed = text ? cacheSchema.safeParse(JSON.parse(text)) : null;
      if (parsed?.success && parsed.data.ownerId === this.ownerId) {
        const c = parsed.data;
        if (c.pending || c.revision >= this.state.revision) {
          this.pending = c.pending
            ? { settings: c.settings, baseRevision: c.revision, mutationId: c.mutationId! }
            : null;
          this.emit({ settings: c.settings, revision: c.revision, status: 'local' });
        }
      }
    } catch {
      this.emit({ cacheAvailable: false });
    }
    this.emit({ ready: true });
    const stop = this.io.online(() => {
      void this.refresh();
    });
    void this.refresh();
    return () => {
      this.active = false;
      this.generation++;
      this.abort.abort();
      this.writing = false;
      stop();
    };
  }
  private cache() {
    try {
      this.io!.write(
        this.cacheKey,
        JSON.stringify({
          ownerId: this.ownerId,
          settings: this.state.settings,
          revision: this.pending?.baseRevision ?? this.state.revision,
          pending: !!this.pending,
          mutationId: this.pending?.mutationId ?? null,
        }),
      );
      if (!this.state.cacheAvailable) this.emit({ cacheAvailable: true });
    } catch {
      if (this.state.cacheAvailable) this.emit({ cacheAvailable: false });
    }
  }
  private adopt(remote: ForgeRemoteSettings) {
    this.activity++;
    this.pending = null;
    this.emit({
      settings: remote.settings,
      revision: remote.revision,
      status: 'cloud',
      conflict: null,
    });
    this.cache();
  }
  async refresh() {
    if (!this.active || this.writing || this.state.status === 'account-changed') return;
    const generation = this.generation;
    const activity = this.activity;
    try {
      const response = await this.io!.request('/api/fold-settings', {
        cache: 'no-store',
        signal: this.abort.signal,
      });
      if (!this.active || generation !== this.generation) return;
      if (response.status === 401 || response.status === 403) {
        this.emit({ status: 'account-changed' });
        return;
      }
      if (!response.ok) throw Error('Settings read unavailable');
      const remote = remoteSchema.parse(await response.json());
      if (!this.active || generation !== this.generation) return;
      if (remote.userId !== this.ownerId) {
        this.emit({ status: 'account-changed' });
        return;
      }
      if (activity !== this.activity) {
        if (!this.writing) void this.refresh();
        return;
      }
      if (this.pending) {
        if (remote.lastMutationId === this.pending.mutationId) this.adopt(remote);
        else if (remote.revision === this.pending.baseRevision) {
          this.emit({ revision: remote.revision, conflict: null });
          await this.flush();
        } else this.emit({ status: 'conflict', conflict: remote });
      } else if (
        (!this.refreshed && remote.revision >= this.state.revision) ||
        (remote.revision === this.state.revision &&
          JSON.stringify(remote.settings) === JSON.stringify(this.state.settings))
      )
        this.adopt(remote);
      else this.emit({ status: 'conflict', conflict: remote });
      this.refreshed = true;
    } catch {
      if (this.active && generation === this.generation) this.emit({ status: 'local' });
    }
  }
  async apply(value: ForgeSettings) {
    if (!this.active || this.state.status === 'account-changed') return;
    const settings = forgeSettingsSchema.parse(value);
    this.activity++;
    this.pending = { settings, baseRevision: this.state.revision, mutationId: crypto.randomUUID() };
    this.emit({ settings, status: this.state.conflict ? 'conflict' : 'local' });
    this.cache();
    if (!this.state.conflict) await this.flush();
  }
  async keepLocal(value?: ForgeSettings) {
    if (!this.state.conflict || !this.active) return;
    const settings = forgeSettingsSchema.parse(value ?? this.state.settings);
    this.activity++;
    this.pending = {
      settings,
      baseRevision: this.state.conflict.revision,
      mutationId: crypto.randomUUID(),
    };
    this.emit({
      settings,
      revision: this.state.conflict.revision,
      conflict: null,
      status: 'local',
    });
    this.cache();
    await this.flush();
  }
  useCloud() {
    if (this.state.conflict) this.adopt(this.state.conflict);
  }
  private async flush() {
    if (
      !this.active ||
      !this.pending ||
      this.writing ||
      this.state.status === 'account-changed' ||
      this.state.conflict
    )
      return;
    const pending = this.pending,
      generation = this.generation;
    this.writing = true;
    this.emit({ status: 'saving' });
    let continueWriting = false;
    try {
      const response = await this.io!.request('/api/fold-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.abort.signal,
        body: JSON.stringify({
          ownerId: this.ownerId,
          expectedRevision: pending.baseRevision,
          mutationId: pending.mutationId,
          settings: pending.settings,
        }),
      });
      if (!this.active || generation !== this.generation) return;
      if (response.status === 401 || response.status === 403) {
        this.emit({ status: 'account-changed' });
        return;
      }
      if (!response.ok && response.status !== 409) throw Error('Settings write unavailable');
      const remote = remoteSchema.parse(await response.json());
      if (!this.active || generation !== this.generation) return;
      if (remote.userId !== this.ownerId) {
        this.emit({ status: 'account-changed' });
        return;
      }
      if (response.status === 409) {
        this.emit({ status: 'conflict', conflict: remote });
        return;
      }
      if (this.pending?.mutationId === pending.mutationId) this.adopt(remote);
      else if (this.pending) {
        this.pending.baseRevision = remote.revision;
        this.emit({ revision: remote.revision, status: 'local' });
        this.cache();
        continueWriting = true;
      }
    } catch {
      if (this.active && generation === this.generation) {
        this.emit({ status: 'local' });
        this.cache();
      }
    } finally {
      if (generation === this.generation) {
        this.writing = false;
        if (continueWriting) void this.flush();
      }
    }
  }
}
