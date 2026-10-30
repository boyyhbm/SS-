import { z } from 'zod';

export const UPSTREAM_REVISION = '327b22c39041f197a4cfdf2544f81799b332b6c7';
export const NFSU_RUNTIME_KEY = 'nfs-underground';
export const PACKAGE_FORMAT = 'nexus-nfsu-local/v1';
export const EXE_TIMESTAMP = 0x40072965;
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export function safeRelativePath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !/[\\\x00-\x1f:?#]/.test(path) &&
    path.split('/').every((p) => p !== '' && p !== '.' && p !== '..')
  );
}
const relative = z.string().refine(safeRelativePath, 'Unsafe relative path');
export const packageSchema = z
  .object({
    format: z.literal(PACKAGE_FORMAT),
    upstreamRevision: z.literal(UPSTREAM_REVISION),
    exe: z
      .object({ version: z.literal('1.4'), peTimestamp: z.literal(EXE_TIMESTAMP), sha256: hash })
      .strict(),
    module: z
      .object({
        path: z.literal('runtime/nfsu1.wasm'),
        sha256: hash,
        size: z
          .number()
          .int()
          .positive()
          .max(512 * 1024 * 1024),
        info: z
          .object({
            pages: z.number().int().min(10240).max(32768),
            maxPages: z.literal(65536),
            guestEnd: z.literal(671088640),
            rev: z.string().max(64),
            opt: z.string().max(16),
            lift: z.literal('plain'),
            size: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: relative,
            size: z
              .number()
              .int()
              .nonnegative()
              .max(2 * 1024 ** 3),
            mtime: z.number().int().nonnegative(),
            sha256: hash,
          })
          .strict(),
      )
      .min(1)
      .max(30000),
    directories: z.array(relative).max(10000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = new Set<string>(),
      cacheKeys = new Set<string>();
    let total = value.module.size;
    for (const file of value.files) {
      const path = file.path.toLowerCase(),
        key = cacheFilename(file);
      if (paths.has(path) || cacheKeys.has(key))
        ctx.addIssue({ code: 'custom', message: 'Duplicate or colliding game paths' });
      paths.add(path);
      cacheKeys.add(key);
      total += file.size;
    }
    const directories = new Set<string>();
    for (const directory of value.directories) {
      const key = directory.toLowerCase();
      if (paths.has(key) || directories.has(key))
        ctx.addIssue({ code: 'custom', message: 'Duplicate directory or file/directory conflict' });
      directories.add(key);
    }
    for (const path of [...paths, ...directories]) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/');
        if (paths.has(parent) || !directories.has(parent))
          ctx.addIssue({ code: 'custom', message: 'Invalid game directory hierarchy' });
      }
    }
    const exe = value.files.find((f) => f.path.toLowerCase() === 'speed.exe');
    if (!exe || exe.sha256 !== value.exe.sha256)
      ctx.addIssue({ code: 'custom', message: 'SPEED.EXE identity is missing' });
    if (total > 8 * 1024 ** 3 || value.module.size !== value.module.info.size)
      ctx.addIssue({ code: 'custom', message: 'Invalid package size' });
  });
export type UndergroundPackage = z.infer<typeof packageSchema>;
export const cacheFilename = (f: { path: string; size: number; mtime: number }) =>
  `${f.path.replace(/[^A-Za-z0-9._-]/g, '_')}.${f.size}.${f.mtime}`;

export function inspectExecutable(header: Uint8Array) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length < 64 || view.getUint16(0, true) !== 0x5a4d)
    throw Error('SPEED.EXE: missing DOS header');
  const at = view.getUint32(0x3c, true);
  if (
    at < 64 ||
    at + 80 > header.length ||
    view.getUint32(at, true) !== 0x4550 ||
    view.getUint16(at + 4, true) !== 0x14c ||
    view.getUint16(at + 24, true) !== 0x10b ||
    view.getUint32(at + 52, true) !== 0x400000
  )
    throw Error('SPEED.EXE: incompatible x86 PE image');
  const timestamp = view.getUint32(at + 8, true);
  if (timestamp !== EXE_TIMESTAMP) throw Error('Required SPEED.EXE 1.4 timestamp 0x40072965');
  return { peTimestamp: timestamp, version: '1.4' as const };
}
export function validateThreadedModule(wasm: WebAssembly.Module) {
  const exports = WebAssembly.Module.exports(wasm),
    imports = WebAssembly.Module.imports(wasm);
  if (
    !exports.some((e) => e.name === '_start' && e.kind === 'function') ||
    !exports.some((e) => e.name === 'wasi_thread_start' && e.kind === 'function') ||
    !imports.some((e) => e.module === 'env' && e.name === 'memory' && e.kind === 'memory')
  )
    throw Error('Этот WASM не соответствует threaded WASI runtime nfsu1-web.');
}

export const saveEntrySchema = z
  .object({
    path: relative,
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(16 * 1024 * 1024),
    sha256: hash,
    base64: z.string().max(24 * 1024 * 1024),
  })
  .strict();
export const saveArchiveSchema = z
  .object({
    format: z.literal('nexus-nfsu-saves/v1'),
    gameVersion: z.literal('1.4'),
    createdAt: z.iso.datetime(),
    files: z.array(saveEntrySchema).max(512),
  })
  .strict();
export function allowedSavePath(path: string) {
  return (
    safeRelativePath(path) &&
    (path === 'registry.txt' ||
      path === 'settings.ini' ||
      /^NFS Underground\/[^/]+\.(usr|opt|cfg|ugd)$/i.test(path))
  );
}

export const bridgeSchema = z
  .object({
    protocol: z.literal('nexus-nfsu'),
    version: z.literal(1),
    nonce: z.uuid(),
    type: z.enum(['ready', 'init', 'state', 'exit', 'error']),
    payload: z.unknown().optional(),
  })
  .strict();
export const initSchema = z
  .object({ namespace: z.string().regex(/^[a-f0-9]{64}$/), controls: z.unknown().optional() })
  .strict();
// First-party fallback for browsers that deny OPFS to cross-site frames.
// The fragment contains only the same non-secret local context as the iframe bridge.
export function parseDirectLaunch(fragment: string) {
  if (!fragment.startsWith('#launch=') || fragment.length > 24000) return null;
  try {
    const message = bridgeSchema.parse(JSON.parse(decodeURIComponent(fragment.slice(8))));
    if (message.type !== 'init') return null;
    return { nonce: message.nonce, context: initSchema.parse(message.payload) };
  } catch {
    return null;
  }
}
export type UndergroundBridge = z.infer<typeof bridgeSchema>;
export async function accountNamespace(origin: string, accountId: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`nexus/nfsu1/v1\0${origin}\0${accountId}`),
  );
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
