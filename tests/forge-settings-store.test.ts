import { describe, it, expect } from 'vitest';
import { ForgeSettingsStore, type ForgeSettingsIO } from '../src/games/fold/settings-store';
import { defaultForgeSettings, type ForgeSettings } from '../src/games/fold/settings';

const settle = async () => {
  for (let i = 0; i < 16; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture() {
  const cache = new Map<string, string>();
  let remote = {
    userId: 'owner-A',
    settings: structuredClone(defaultForgeSettings),
    revision: 0,
    lastMutationId: null as string | null,
    updatedAt: null as string | null,
  };
  let offline = false,
    loseAck = false,
    writes = 0;
  const requests: {
    ownerId: string;
    expectedRevision: number;
    mutationId: string;
    settings: ForgeSettings;
  }[] = [];
  const io: ForgeSettingsIO = {
    read: (key) => cache.get(key) ?? null,
    write: (key, value) => {
      cache.set(key, value);
    },
    online: () => () => {},
    request: async (_url, init) => {
      if (offline) throw Error('Offline');
      if (init?.method !== 'POST') return response(remote);
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if (body.ownerId !== remote.userId) return response({}, 403);
      if (body.mutationId === remote.lastMutationId) return response(remote);
      if (body.expectedRevision !== remote.revision) return response(remote, 409);
      remote = {
        userId: remote.userId,
        settings: body.settings,
        revision: remote.revision + 1,
        lastMutationId: body.mutationId,
        updatedAt: new Date().toISOString(),
      };
      writes++;
      if (loseAck) {
        loseAck = false;
        throw Error('Response lost after commit');
      }
      return response(remote);
    },
  };
  return {
    cache,
    io,
    requests,
    get remote() {
      return remote;
    },
    set remote(v) {
      remote = v;
    },
    set offline(v: boolean) {
      offline = v;
    },
    set loseAck(v: boolean) {
      loseAck = v;
    },
    get writes() {
      return writes;
    },
  };
}
describe('account-owned FOLD settings persistence', () => {
  it('loads a local offline edit after reload, then writes it only to its owner', async () => {
    const f = fixture();
    f.offline = true;
    const a = new ForgeSettingsStore('owner-A', {}, f.io),
      stop = a.start();
    await settle();
    const custom = structuredClone(defaultForgeSettings);
    custom.mouse.x = 1.8;
    await a.apply(custom);
    expect(a.getSnapshot().status).toBe('local');
    stop();
    const other = new ForgeSettingsStore('owner-B', {}, f.io),
      stopOther = other.start();
    await settle();
    expect(other.getSnapshot().settings.mouse.x).toBe(1);
    stopOther();
    const reload = new ForgeSettingsStore('owner-A', {}, f.io),
      stopReload = reload.start();
    await settle();
    expect(reload.getSnapshot().settings.mouse.x).toBe(1.8);
    f.offline = false;
    await reload.refresh();
    expect(reload.getSnapshot().status).toBe('cloud');
    expect(f.remote.settings.mouse.x).toBe(1.8);
    expect(f.requests.every((r) => r.ownerId === 'owner-A')).toBe(true);
    stopReload();
  });
  it('does not silently replace a concurrent edit; both explicit resolutions are available', async () => {
    const f = fixture(),
      a = new ForgeSettingsStore('owner-A', {}, f.io),
      stop = a.start();
    await settle();
    f.remote = {
      ...f.remote,
      revision: 1,
      settings: { ...defaultForgeSettings, mouse: { ...defaultForgeSettings.mouse, x: 2 } },
    };
    const own = { ...defaultForgeSettings, mouse: { ...defaultForgeSettings.mouse, x: 0.7 } };
    await a.apply(own);
    expect(a.getSnapshot().status).toBe('conflict');
    expect(f.remote.settings.mouse.x).toBe(2);
    expect(a.getSnapshot().settings.mouse.x).toBe(0.7);
    await a.keepLocal();
    expect(f.remote.revision).toBe(2);
    expect(f.remote.settings.mouse.x).toBe(0.7);
    f.remote = { ...f.remote, revision: 3, settings: defaultForgeSettings };
    await a.refresh();
    expect(a.getSnapshot().status).toBe('conflict');
    a.useCloud();
    expect(a.getSnapshot().settings).toEqual(defaultForgeSettings);
    expect(a.getSnapshot().revision).toBe(3);
    stop();
  });
  it('recovers a lost acknowledgement without incrementing the record twice', async () => {
    const f = fixture(),
      a = new ForgeSettingsStore('owner-A', {}, f.io),
      stop = a.start();
    await settle();
    f.loseAck = true;
    await a.apply({ ...defaultForgeSettings, mouse: { ...defaultForgeSettings.mouse, y: 1.7 } });
    expect(f.writes).toBe(1);
    expect(a.getSnapshot().status).toBe('local');
    await a.refresh();
    expect(a.getSnapshot().status).toBe('cloud');
    expect(f.writes).toBe(1);
    expect(a.getSnapshot().revision).toBe(1);
    stop();
  });
  it('locks writes when authentication has changed on a shared device', async () => {
    const f = fixture(),
      a = new ForgeSettingsStore('owner-A', {}, f.io),
      stop = a.start();
    await settle();
    f.remote = { ...f.remote, userId: 'owner-B' };
    await a.refresh();
    expect(a.getSnapshot().status).toBe('account-changed');
    await a.apply(defaultForgeSettings);
    expect(f.requests).toHaveLength(0);
    stop();
  });
  it('keeps a newer edit when an old GET or POST is still in flight', async () => {
    const f = fixture();
    let resolveRead!: (value: Response) => void, resolveWrite!: (value: Response) => void;
    const old = { ...f.remote };
    let waitWrite = false;
    const io: ForgeSettingsIO = {
      ...f.io,
      request: async (url, init) => {
        if (init?.method !== 'POST')
          return new Promise<Response>((resolve) => {
            resolveRead = resolve;
          });
        const result = await f.io.request(url, init);
        if (waitWrite) {
          waitWrite = false;
          return new Promise<Response>((resolve) => {
            resolveWrite = () => resolve(result);
          });
        }
        return result;
      },
    };
    const a = new ForgeSettingsStore('owner-A', {}, io),
      stop = a.start();
    const one = { ...defaultForgeSettings, mouse: { ...defaultForgeSettings.mouse, x: 1.3 } };
    waitWrite = true;
    const pending = a.apply(one);
    await settle();
    await a.apply({ ...one, mouse: { ...one.mouse, x: 1.9 } });
    resolveRead(response(old));
    await settle();
    expect(a.getSnapshot().settings.mouse.x).toBe(1.9);
    resolveWrite(response({}));
    await pending;
    await settle();
    expect(f.remote.settings.mouse.x).toBe(1.9);
    expect(a.getSnapshot().status).toBe('cloud');
    stop();
  });
  it('reports blocked browser storage instead of claiming a durable fallback', async () => {
    const f = fixture();
    f.offline = true;
    const a = new ForgeSettingsStore(
      'owner-A',
      {},
      {
        ...f.io,
        read: () => {
          throw Error('Blocked');
        },
        write: () => {
          throw Error('Blocked');
        },
      },
    );
    const stop = a.start();
    await settle();
    await a.apply(defaultForgeSettings);
    expect(a.getSnapshot().cacheAvailable).toBe(false);
    expect(a.getSnapshot().status).toBe('local');
    stop();
  });
});
