// Starting the game process from the page: the shared memory, the control
// and RPC blocks, the I/O worker and a pool of game-thread workers.
import { CTL_EXIT, CTL_INTS, CTL_NEXT_TID, CTL_POOL, MAX_THREADS, POOL_RUN_MAIN, RPC_BYTES, type BootConfig, type ToPage } from './proto';
import { tzEnv } from './tz';

export interface ProcessOptions {
  /** NEXUS patch: cancel a boot without leaving its I/O/game workers or OPFS handles alive. */
  signal?: AbortSignal;
  module: WebAssembly.Module;
  cfg: BootConfig;
  pool?: number;                         // game-thread workers (the game uses ~10 threads)
  initialPages?: number;                 // wasm pages (64 KiB) of the shared memory at start
  onLog?: (s: string, fd: number, tid: number) => void;
  onExit?: (code: number) => void;
  onRegister?: (kind: number, ptr: number, size: number) => void;
  /** the game closed a file of the save overlay it had written (a profile, registry.txt ...), path relative to /save */
  onSaved?: (path: string) => void;
  /** a line of the host's own for the log, from no game thread (the I/O worker's "[data] ...") */
  onNote?: (s: string) => void;
}

export interface GameProcess {
  memory: WebAssembly.Memory;
  ctl: Int32Array;
  exited: Promise<number>;
  terminate(): void;
  /** resolves with the structure a subsystem published (runtime/web/host_abi.h) */
  registered(kind: number): Promise<{ ptr: number; size: number }>;
}

function memoryPagesOf(mod: WebAssembly.Module): number | null {
  // the module imports env.memory; its declared minimum is not exposed by the
  // JS API, so the build writes it into a custom section "nfsu2.mem"
  const s = WebAssembly.Module.customSections(mod, 'nfsu2.mem');
  return s.length ? new DataView(s[0]).getUint32(0, true) : null;
}

export async function startProcess(o: ProcessOptions): Promise<GameProcess> {
  o.signal?.throwIfAborted();
  const pool = Math.min(o.pool ?? 24, MAX_THREADS);
  // the page's time zone (WASI has none); an explicit NFSU2_TZ in the config wins
  const cfg: BootConfig = { ...o.cfg, env: { ...tzEnv(), ...o.cfg.env } };
  const initial = o.initialPages ?? memoryPagesOf(o.module) ?? 16384;
  const memory = new WebAssembly.Memory({ initial, maximum: 65536, shared: true });
  const ctlBuf = new SharedArrayBuffer(CTL_INTS * 4), rpc = new SharedArrayBuffer(RPC_BYTES);
  const ctl = new Int32Array(ctlBuf);
  ctl[CTL_NEXT_TID] = 1;

  const regs = new Map<number, { ptr: number; size: number }>();
  const regWaiters = new Map<number, ((r: { ptr: number; size: number }) => void)[]>();
  let resolveExit!: (c: number) => void;
  const exited = new Promise<number>(r => (resolveExit = r));
  const workers: Worker[] = [];
  const ready: Promise<void>[] = [];
  const pendingBoots = new Set<() => void>();
  let stopped = false;
  const terminate = () => {
    if (stopped) return;
    stopped = true;
    for (const cancel of [...pendingBoots]) cancel();
    for (const w of workers) w.terminate();
    resolveExit(-1);
    o.signal?.removeEventListener('abort', terminate);
  };
  o.signal?.addEventListener('abort', terminate, { once: true });
  const waitReady = (worker: Worker, accept: (e: MessageEvent) => boolean) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); pendingBoots.delete(abort); o.signal?.removeEventListener('abort', abort); worker.removeEventListener('message', message); worker.removeEventListener('error', error); };
    const fail = (reason: unknown) => { cleanup(); reject(reason); };
    const abort = () => fail(o.signal?.reason ?? new Error('Runtime boot cancelled'));
    const message = (event: MessageEvent) => {
      if (event.data?.t === 'io-error' || event.data?.t === 'trap') { fail(new Error(event.data.msg ?? 'Worker boot failed')); return; }
      if (accept(event)) { cleanup(); resolve(); }
    };
    const error = (event: ErrorEvent) => fail(new Error(event.message || 'Worker boot failed'));
    const timer = setTimeout(() => fail(new Error('Runtime worker initialization timed out')), 30000);
    pendingBoots.add(abort);
    worker.addEventListener('message', message); worker.addEventListener('error', error);
    o.signal?.addEventListener('abort', abort, { once: true });
    if (o.signal?.aborted) abort();
  });
  const onMsg = (e: MessageEvent<ToPage | { t: 'register'; kind: number; ptr: number; size: number }>) => {
    const m = e.data;
    if (m.t === 'log') o.onLog?.(m.s, m.fd, m.tid);
    else if (m.t === 'trap') o.onLog?.(`TRAP in thread ${m.tid}: ${m.msg}\n${m.stack ?? ''}`, 2, m.tid);
    else if (m.t === 'exit') { o.onExit?.(m.code); resolveExit(m.code); }
    else if (m.t === 'register') {
      regs.set(m.kind, { ptr: m.ptr, size: m.size });
      for (const w of regWaiters.get(m.kind) ?? []) w({ ptr: m.ptr, size: m.size });
      regWaiters.delete(m.kind);
      o.onRegister?.(m.kind, m.ptr, m.size);
    }
  };

  try {
  const io = new Worker(new URL('/nfsu/host/io-worker.js', import.meta.url), { type: 'module', name: 'io' });
  workers.push(io);
  const ioReady = waitReady(io, e => e.data.t === 'io-ready');
  io.postMessage({ memory, ctl: ctlBuf, rpc, cfg });
  await ioReady;
  io.onmessage = (e) => { if (e.data.t === 'saved') o.onSaved?.(e.data.path); else if (e.data.t === 'log') o.onNote?.(e.data.s); };

  for (let s = 0; s < pool; s++) {
    const w = new Worker(new URL('/nfsu/host/game-worker.js', import.meta.url), { type: 'module', name: `game-${s}` });
    ready.push(waitReady(w, e => e.data.t === 'ready'));
    w.onmessage = e => { if (e.data.t !== 'ready') onMsg(e); };
    w.postMessage({ mod: o.module, memory, ctl: ctlBuf, rpc, slot: s, pool, cfg });
    workers.push(w);
  }
  await Promise.all(ready);
  // slot 0 runs the process entry
  Atomics.store(ctl, CTL_POOL, POOL_RUN_MAIN); Atomics.notify(ctl, CTL_POOL);

  return {
    memory, ctl, exited,
    registered(kind: number) {
      const r = regs.get(kind);
      if (r) return Promise.resolve(r);
      return new Promise(res => { const l = regWaiters.get(kind) ?? []; l.push(res); regWaiters.set(kind, l); });
    },
    terminate,
  };
  } catch (error) { terminate(); await Promise.allSettled(ready); throw error; }
}
