import './schema-policy';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  packageSchema,
  cacheFilename,
  inspectExecutable,
  allowedSavePath,
  saveArchiveSchema,
  MAX_SAVE_BYTES,
  type UndergroundPackage,
} from '../../src/games/underground/contracts';
import { ug1File, badFile, readIndex } from '../../vendor/nfsu1-web/src/app/ug1save';

type Directory = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};
export const MODULE_NAME = 'module.wasm';
const BLOCK = 1 << 20;
export const prefix = (namespace: string) => 'nexus-nfsu-' + namespace;
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
export async function digest(blob: Blob) {
  const state = sha256.create(),
    reader = blob.stream().getReader();
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      state.update(r.value);
    }
    return hex(state.digest());
  } finally {
    reader.releaseLock();
  }
}
export async function root(namespace: string) {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(prefix(namespace), {
    create: true,
  });
}
export async function cachedPackage(
  namespace: string,
): Promise<{ manifest: UndergroundPackage; dataDir: string; module: File } | null> {
  try {
    const base = await root(namespace),
      state = JSON.parse(
        await (await (await base.getFileHandle('installed.json')).getFile()).text(),
      );
    const manifest = packageSchema.parse(state.manifest);
    if (typeof state.dataDir !== 'string' || !/^nexus-nfsu-data-[a-f0-9-]{36}$/.test(state.dataDir))
      return null;
    const data = await (await navigator.storage.getDirectory()).getDirectoryHandle(state.dataDir);
    return {
      manifest,
      dataDir: state.dataDir,
      module: await (await data.getFileHandle(MODULE_NAME)).getFile(),
    };
  } catch {
    return null;
  }
}
async function write(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string | Uint8Array,
) {
  const handle = await dir.getFileHandle(name, { create: true }),
    writer = await handle.createWritable();
  try {
    if (data instanceof Blob) await data.stream().pipeTo(writer);
    else {
      await writer.write(data as FileSystemWriteChunkType);
      await writer.close();
    }
  } catch (e) {
    try {
      await writer.abort();
    } catch {}
    throw e;
  }
}
export async function importPackage(
  namespace: string,
  selected: readonly File[],
  progress: (text: string) => void,
) {
  if (!selected.length) throw Error('Папка не выбрана.');
  const map = new Map<string, File>();
  for (const file of selected) {
    const rel = file.webkitRelativePath.split('/').slice(1).join('/');
    if (map.has(rel)) throw Error('Повторяющиеся файлы комплекта.');
    map.set(rel, file);
  }
  const manifestFile = map.get('nexus-nfsu-package.json');
  if (!manifestFile || manifestFile.size > 12 * 1024 * 1024)
    throw Error(
      'Нужна подготовленная папка с nexus-nfsu-package.json и WASM. Обычная папка игры не заменяет локальную сборку.',
    );
  const manifest = packageSchema.parse(JSON.parse(await manifestFile.text()));
  const wasm = map.get(manifest.module.path);
  if (!wasm || wasm.size !== manifest.module.size)
    throw Error('Локальный WASM отсутствует или имеет другой размер.');
  const exeMeta = manifest.files.find((f) => f.path.toLowerCase() === 'speed.exe')!,
    exe = map.get('data/' + exeMeta.path);
  if (!exe) throw Error('Не найден SPEED.EXE в подготовленном комплекте.');
  inspectExecutable(
    new Uint8Array(await exe.slice(0, Math.min(exe.size, 1024 * 1024)).arrayBuffer()),
  );
  progress('Проверка локального WASM…');
  if ((await digest(wasm)) !== manifest.module.sha256)
    throw Error('Хеш WASM не совпадает с комплектом.');
  const estimate = await navigator.storage.estimate(),
    total = manifest.files.reduce((n, f) => n + f.size, wasm.size);
  if (estimate.quota && total > estimate.quota - (estimate.usage ?? 0))
    throw Error('Браузеру не хватает локального места для комплекта.');
  const opfs = await navigator.storage.getDirectory(),
    dataDir = 'nexus-nfsu-data-' + crypto.randomUUID(),
    dest = await opfs.getDirectoryHandle(dataDir, { create: true });
  const previous = await cachedPackage(namespace);
  try {
    let done = 0;
    for (const meta of manifest.files) {
      const file = map.get('data/' + meta.path);
      if (!file || file.size !== meta.size) throw Error('Отсутствует файл комплекта: ' + meta.path);
      progress(`Проверка и локальное копирование ${++done} / ${manifest.files.length}`);
      if ((await digest(file)) !== meta.sha256)
        throw Error('Повреждён файл комплекта: ' + meta.path);
      await write(dest, cacheFilename(meta), file);
      await write(
        dest,
        cacheFilename(meta) + '.have',
        new Uint8Array(Math.ceil(meta.size / BLOCK)).fill(1),
      );
    }
    const base = await root(namespace);
    // Keep the old installed record until every byte of the new data is verified.
    await write(dest, MODULE_NAME, wasm);
    await write(base, 'installed.json', JSON.stringify({ manifest, dataDir }));
    if (previous?.dataDir && previous.dataDir !== dataDir)
      await opfs.removeEntry(previous.dataDir, { recursive: true }).catch(() => {});
  } catch (error) {
    await opfs.removeEntry(dataDir, { recursive: true }).catch(() => {});
    throw error;
  }
  return (await cachedPackage(namespace))!;
}
export async function saveDirectory(namespace: string) {
  let name = prefix(namespace) + '-saves';
  try {
    const pointer = JSON.parse(
      await (
        await (await (await root(namespace)).getFileHandle('save-pointer.json')).getFile()
      ).text(),
    );
    if (
      typeof pointer.name === 'string' &&
      new RegExp('^' + name + '-[a-f0-9-]{36}$').test(pointer.name)
    )
      name = pointer.name;
  } catch {}
  return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
}
async function walk(dir: FileSystemDirectoryHandle, path = '') {
  const files: { path: string; file: File }[] = [];
  for await (const [name, item] of (dir as Directory).entries()) {
    const rel = path ? path + '/' + name : name;
    if (item.kind === 'directory')
      files.push(...(await walk(item as FileSystemDirectoryHandle, rel)));
    else if (allowedSavePath(rel))
      files.push({ path: rel, file: await (item as FileSystemFileHandle).getFile() });
    if (files.length > 512) throw Error('Слишком много файлов сохранения.');
  }
  return files;
}
export async function listSaves(namespace: string) {
  return (await walk(await saveDirectory(namespace))).map((f) => ({
    path: f.path,
    bytes: f.file.size,
    updatedAt: f.file.lastModified,
  }));
}
const base64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
export async function exportSaves(namespace: string) {
  const files = await walk(await saveDirectory(namespace));
  if (files.reduce((n, f) => n + f.file.size, 0) > MAX_SAVE_BYTES)
    throw Error('Сохранения превышают 64 МБ.');
  return {
    format: 'nexus-nfsu-saves/v1' as const,
    gameVersion: '1.4' as const,
    createdAt: new Date().toISOString(),
    files: await Promise.all(
      files.map(async (f) => ({
        path: f.path,
        bytes: f.file.size,
        sha256: await digest(f.file),
        base64: base64(new Uint8Array(await f.file.arrayBuffer())),
      })),
    ),
  };
}
export async function importSaves(
  namespace: string,
  file: File,
  options: { replace?: boolean } = {},
) {
  if (file.size > 96 * 1024 * 1024) throw Error('Архив сохранения слишком велик.');
  const archive = saveArchiveSchema.parse(JSON.parse(await file.text()));
  let total = 0;
  const seen = new Set<string>(),
    decoded: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of archive.files) {
    if (!allowedSavePath(entry.path) || seen.has(entry.path.toLowerCase()))
      throw Error('Недопустимый путь сохранения.');
    seen.add(entry.path.toLowerCase());
    const bytes = Uint8Array.from(atob(entry.base64), (c) => c.charCodeAt(0));
    total += bytes.length;
    if (
      bytes.length !== entry.bytes ||
      total > MAX_SAVE_BYTES ||
      hex(sha256(bytes)) !== entry.sha256
    )
      throw Error('Повреждён архив сохранения.');
    const canonical = entry.path.replace(/^nfs underground\//i, 'NFS Underground/');
    const profile = ug1File(canonical);
    if (/^NFS Underground\/Profiles\.usr$/i.test(canonical) && readIndex(bytes) === null)
      throw Error('Повреждён индекс профилей Underground.');
    if (profile) {
      const problem = badFile(profile.kind, profile.name, bytes);
      if (problem) throw Error(problem);
    }
    // Windows save paths share one case-insensitive directory. OPFS must not
    // split a profile across two folders when an imported archive changes case.
    decoded.push({ path: canonical, bytes });
  }
  const base = await root(namespace),
    backup = await exportSaves(namespace);
  const name = 'backup-' + Date.now() + '-' + crypto.randomUUID() + '.json';
  await write(base, name, JSON.stringify(backup));
  // Stage a complete save overlay. Publish its pointer only after every write
  // closes successfully; an interrupted import leaves the old overlay intact.
  const opfs = await navigator.storage.getDirectory(),
    next = prefix(namespace) + '-saves-' + crypto.randomUUID();
  const target = await opfs.getDirectoryHandle(next, { create: true });
  try {
    const combined = new Map<string, { path: string; bytes: Uint8Array }>(
      (options.replace ? [] : backup.files).map((f) => [
        f.path.toLowerCase(),
        {
          path: f.path.replace(/^nfs underground\//i, 'NFS Underground/'),
          bytes: Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
        },
      ]),
    );
    for (const entry of decoded) combined.set(entry.path.toLowerCase(), entry);
    if (
      combined.size > 512 ||
      [...combined.values()].reduce((sum, f) => sum + f.bytes.length, 0) > MAX_SAVE_BYTES
    )
      throw Error('Объединённое сохранение превышает допустимый размер.');
    for (const { path, bytes } of combined.values()) {
      const parts = path.split('/');
      let dir = target;
      for (const part of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(part, { create: true });
      await write(dir, parts.at(-1)!, bytes);
    }
    await write(base, 'save-pointer.json', JSON.stringify({ name: next }));
  } catch (error) {
    await opfs.removeEntry(next, { recursive: true }).catch(() => {});
    throw error;
  }
  return name;
}
export async function makeBackup(namespace: string) {
  const archive = await exportSaves(namespace),
    name = 'backup-' + Date.now() + '-' + crypto.randomUUID() + '.json';
  await write(await root(namespace), name, JSON.stringify(archive));
  return name;
}
export async function backups(namespace: string) {
  const out: { name: string; bytes: number }[] = [];
  for await (const [name, item] of ((await root(namespace)) as Directory).entries())
    if (item.kind === 'file' && /^backup-[0-9]+-[a-f0-9-]{36}\.json$/.test(name))
      out.push({ name, bytes: (await (item as FileSystemFileHandle).getFile()).size });
  return out.sort((a, b) => b.name.localeCompare(a.name));
}
export async function backupFile(namespace: string, name: string) {
  if (!/^backup-[0-9]+-[a-f0-9-]{36}\.json$/.test(name))
    throw Error('Неизвестная резервная копия.');
  return (await (await root(namespace)).getFileHandle(name)).getFile();
}
