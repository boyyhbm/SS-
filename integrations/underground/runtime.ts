import './schema-policy';
import { GameSession } from '../../vendor/nfsu1-web/src/app/game';
import { measureRefresh, enterFullscreen } from '../../vendor/nfsu1-web/src/app/display';
import {
  bridgeSchema,
  initSchema,
  parseDirectLaunch,
  validateThreadedModule,
  UPSTREAM_REVISION,
} from '../../src/games/underground/contracts';
import { controllerConfigSchema } from '../../src/input/profiles';
import {
  cachedPackage,
  importPackage,
  listSaves,
  exportSaves,
  importSaves,
  saveDirectory,
  root,
  makeBackup,
  backups,
  backupFile,
} from './storage';
import { setPadPreferences } from './pad';
import seedRegistry from '../../vendor/nfsu1-web/registry-defaults.txt';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const parentOrigin =
  document.querySelector<HTMLMetaElement>('meta[name=nexus-parent-origin]')?.content ?? '';
const directLaunch = window.parent === window ? parseDirectLaunch(location.hash) : null;
const nonce = directLaunch?.nonce ?? location.hash.slice(1);
let namespace = '',
  initialized = false,
  session: GameSession | null = null,
  importing = false;
let boot: AbortController | null = null,
  currentAudio: AudioContext | null = null;
let displayHz = 60;
const canvas = el<HTMLCanvasElement>('game'),
  stage = el('stage'),
  status = el('status');
const compatibility: string[] = [];
const busy = () => !!session || !!boot || importing;
const send = (type: 'ready' | 'state' | 'exit' | 'error', payload?: unknown) => {
  if (window.parent === window && type === 'exit' && initialized) {
    location.replace(parentOrigin + '/library');
    return;
  }
  if (window.parent !== window && parentOrigin)
    window.parent.postMessage(
      { protocol: 'nexus-nfsu', version: 1, nonce, type, payload },
      parentOrigin,
    );
};
const say = (message: string) => {
  status.textContent = message;
};
const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Операция не выполнена.';
  say(message);
  send('error', { message: message.slice(0, 1000) });
};
async function fullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  const result = await enterFullscreen(stage);
  if (!result.ok) fail(Error('Полный экран недоступен: ' + (result.error ?? 'ошибка браузера')));
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (!initialized) throw Error('Откройте запуск из вашей библиотеки NEXUS.');
  return navigator.locks.request('nexus-nfsu:' + namespace, { ifAvailable: true }, async (lock) => {
    if (!lock)
      throw Error('Игра или работа с файлами уже открыта в другой вкладке этого аккаунта.');
    return work();
  });
}
async function refresh() {
  if (!namespace) return;
  const data = await cachedPackage(namespace);
  // The running I/O worker owns synchronous save handles. Never reopen them from the page.
  const entries = busy() ? [] : await listSaves(namespace);
  el<HTMLButtonElement>('play').disabled = !data || compatibility.length > 0 || busy();
  el('package').textContent = data
    ? `Комплект найден · SPEED.EXE 1.4 · ${data.manifest.files.length} файлов · локально на устройстве`
    : 'Комплект ещё не выбран. Обычная папка игры без подготовленного WASM не подходит.';
  const list = el('save-list');
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('li');
    row.textContent = `${entry.path} · ${(entry.bytes / 1024).toFixed(1)} КБ`;
    list.append(row);
  }
  el('save-empty').textContent = busy()
    ? 'Сохранения заняты игровым runtime. Экспорт и импорт доступны после остановки.'
    : 'Сохранений пока нет. Профиль создаётся в оригинальном меню игры.';
  el('save-empty').hidden = entries.length > 0;
  for (const id of ['export', 'backup'])
    el<HTMLButtonElement>(id).disabled = busy() || entries.length === 0;
  for (const id of ['resolution', 'fps', 'sound', 'save-input', 'package-input'])
    (el(id) as HTMLInputElement | HTMLSelectElement).disabled = busy();
  const available = await backups(namespace),
    select = el<HTMLSelectElement>('backups');
  select.replaceChildren();
  for (const b of available) {
    const option = document.createElement('option');
    option.value = b.name;
    option.textContent = b.name;
    select.append(option);
  }
  el<HTMLButtonElement>('restore').disabled = busy() || available.length === 0;
}
async function check() {
  let storageBlocked = false;
  if (!isSecureContext) compatibility.push('Нужен HTTPS или localhost.');
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')
    compatibility.push(
      'Не включена изоляция SharedArrayBuffer. Перезапустите страницу через NEXUS.',
    );
  if (
    typeof WebAssembly?.compileStreaming !== 'function' ||
    typeof Atomics.waitAsync !== 'function'
  )
    compatibility.push('Нужен современный браузер с WebAssembly threads и Atomics.waitAsync.');
  if (!navigator.storage?.getDirectory || !navigator.locks)
    compatibility.push('Недоступны OPFS или Web Locks.');
  try {
    await navigator.storage.getDirectory();
  } catch {
    storageBlocked = true;
    compatibility.push(
      'Браузер не разрешает локальное хранилище в этом окне. В NEXUS выберите «Открыть отдельный запуск».',
    );
  }
  try {
    if (
      !navigator.gpu ||
      !(await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))
    )
      compatibility.push('Не найден доступный WebGPU-адаптер.');
  } catch {
    compatibility.push('WebGPU не удалось инициализировать.');
  }
  el('compatibility').textContent = compatibility.length
    ? compatibility.join(' ')
    : 'WebAssembly · WebGPU · SharedArrayBuffer · OPFS доступны. Проверка геймплея требует вашей копии.';
  say(
    compatibility.length
      ? 'Запуск пока недоступен. Причина указана в проверке браузера ниже.'
      : 'Браузер готов. Выберите локально подготовленный комплект.',
  );
  send('state', {
    phase: compatibility.length ? 'unsupported' : 'idle',
    message: el('compatibility').textContent,
    storageBlocked,
  });
  if (storageBlocked) {
    for (const id of [
      'play',
      'package-input',
      'save-input',
      'export',
      'backup',
      'restore',
      'persist',
    ])
      (el(id) as HTMLButtonElement).disabled = true;
    el('package').textContent =
      'Для доступа к файлам нужен отдельный запуск на изолированном адресе.';
  }
  return !storageBlocked;
}
async function preferences(load = false) {
  const dir = await root(namespace),
    resolution = el<HTMLSelectElement>('resolution'),
    fps = el<HTMLSelectElement>('fps'),
    sound = el<HTMLInputElement>('sound');
  if (load) {
    try {
      const value = JSON.parse(
        await (await (await dir.getFileHandle('launcher-settings.json')).getFile()).text(),
      );
      if (Array.from(resolution.options).some((o) => o.value === value.resolution))
        resolution.value = value.resolution;
      if (Array.from(fps.options).some((o) => o.value === value.fps)) fps.value = value.fps;
      if (typeof value.sound === 'boolean') sound.checked = value.sound;
    } catch {
      /* First launch or invalid local preferences: keep safe defaults. */
    }
  } else {
    const writer = await (
      await dir.getFileHandle('launcher-settings.json', { create: true })
    ).createWritable();
    await writer.write(
      JSON.stringify({ resolution: resolution.value, fps: fps.value, sound: sound.checked }),
    );
    await writer.close();
  }
}
async function stop() {
  boot?.abort();
  const active = session;
  session = null;
  active?.terminate();
  await currentAudio?.close().catch(() => {});
  currentAudio = null;
  stage.hidden = true;
  el('stop').hidden = true;
  send('state', { phase: 'stopped' });
  say('Runtime остановлен. Сохранения остались локально.');
}
el<HTMLInputElement>('package-input').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  try {
    await exclusive(async () => {
      importing = true;
      await refresh();
      await importPackage(namespace, files, say);
      say('Комплект проверен и сохранён в OPFS. На сервер ничего не отправлялось.');
    });
  } catch (e) {
    fail(e);
  } finally {
    importing = false;
    await refresh();
  }
});
el('play').addEventListener('click', () => {
  if (busy() || !initialized) return;
  const attempt = new AbortController();
  boot = attempt;
  // Create/resume in this actual user gesture, before asynchronous storage work.
  const audio = el<HTMLInputElement>('sound').checked
    ? new AudioContext({ latencyHint: 'interactive' })
    : null;
  currentAudio = audio;
  void audio?.resume().catch(() => say('Нажмите «Включить звук», если браузер блокирует аудио.'));
  el('stop').hidden = false;
  void exclusive(async () => {
    await refresh();
    if (compatibility.length) throw Error(compatibility.join(' '));
    const data = await cachedPackage(namespace);
    if (!data) throw Error('Сначала выберите локально подготовленный комплект.');
    say('Компиляция локального WebAssembly…');
    send('state', { phase: 'preparing' });
    const before = performance.now();
    const mod = await WebAssembly.compileStreaming(
      new Response(data.module.stream(), { headers: { 'Content-Type': 'application/wasm' } }),
    );
    const compileMs = performance.now() - before;
    attempt.signal.throwIfAborted();
    validateThreadedModule(mod);
    const folder = await saveDirectory(namespace);
    try {
      await folder.getFileHandle('registry.txt');
    } catch {
      const w = await (
        await folder.getFileHandle('registry.txt', { create: true })
      ).createWritable();
      await w.write(seedRegistry);
      await w.close();
    }
    const manifest = {
      files: [
        ...data.manifest.directories.map((p) => ({ p, d: 1 })),
        ...data.manifest.files.map((f) => ({ p: f.path, s: f.size, m: f.mtime })),
      ],
    };
    const manifestUrl = URL.createObjectURL(
      new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    );
    const [width, height] = el<HTMLSelectElement>('resolution').value.split('x').map(Number);
    canvas.width = width;
    canvas.height = height;
    stage.hidden = false;
    let last = performance.now(),
      count = 0;
    const frames: number[] = [];
    try {
      attempt.signal.throwIfAborted();
      const started = await GameSession.start({
        signal: attempt.signal,
        module: mod,
        info: data.manifest.module.info,
        saveDir: folder.name,
        localData: { manifestUrl, cacheDir: data.dataDir },
        env: {
          NFSRES: `${width}x${height}`,
          NFSU2_FPS: el<HTMLSelectElement>('fps').value,
          NFSU2_DISPLAY_HZ: String(displayHz),
          NFSU2_ONLINE: '0',
          NFSU2_ROAM: '0',
          NFSU2_PAD: 'hotplug',
          NFSU2_BACKGROUND: 'pause',
          ...(audio ? {} : { NOSOUND: '1' }),
        },
        canvas,
        stage,
        audio,
        displayHz,
        netName: null,
        log: (line) => {
          if (/TRAP|could not attach/.test(line)) say(line.slice(0, 500));
        },
        onFatal: (message) => {
          fail(Error(message));
          void stop();
        },
        toggleFullscreen: () => {
          void fullscreen().catch(fail);
        },
        onSaved: () => {
          send('state', { phase: count ? 'running' : 'preparing', saved: true });
        },
        onFrame: () => {
          const now = performance.now();
          if (count++) frames.push(now - last);
          last = now;
          if (frames.length > 300) frames.shift();
          if (count === 1) {
            say('Оригинальный runtime выполняется локально.');
            send('state', { phase: 'running' });
          }
          if (count % 20 === 0) {
            const sorted = [...frames].sort((a, b) => b - a),
              avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length),
              slow = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.01))),
              lowMs = slow.reduce((a, b) => a + b, 0) / slow.length;
            el('metrics').textContent =
              `Подача кадров: ${avg ? (1000 / avg).toFixed(1) : '—'} FPS · кадр ${avg.toFixed(1)} мс · 1% low ${lowMs ? (1000 / lowMs).toFixed(1) : '—'} · WASM ${((session?.proc.memory.buffer.byteLength ?? 0) / 1024 ** 2).toFixed(0)} МБ · компиляция ${compileMs.toFixed(0)} мс`;
          }
        },
      });
      session = started;
      attempt.signal.throwIfAborted();
      await refresh();
      await started.exited;
    } finally {
      URL.revokeObjectURL(manifestUrl);
    }
  })
    .catch((e) => {
      if (!attempt.signal.aborted) fail(e);
    })
    .finally(async () => {
      session?.terminate();
      session = null;
      await audio?.close().catch(() => {});
      if (currentAudio === audio) currentAudio = null;
      if (boot === attempt) boot = null;
      stage.hidden = true;
      el('stop').hidden = true;
      send('state', { phase: 'stopped' });
      await refresh().catch(fail);
    });
});
function requestStop() {
  const active = session,
    attempt = boot;
  if (active?.canQuit()) {
    active.requestQuit();
    setTimeout(() => {
      if (session === active && boot === attempt) void stop();
    }, 1800);
  } else void stop();
}
for (const id of ['stop', 'stop-active']) el(id).addEventListener('click', requestStop);
el('unlock').addEventListener('click', () => {
  void currentAudio?.resume().catch(fail);
});
el('fullscreen').addEventListener('click', () => {
  void fullscreen().catch(fail);
});
async function leaveRuntime() {
  const active = session;
  if (active?.canQuit()) {
    active.requestQuit();
    await Promise.race([active.exited, new Promise<void>((resolve) => setTimeout(resolve, 1800))]);
  }
  await stop();
  send('exit');
}
for (const id of ['return', 'return-active'])
  el(id).addEventListener('click', () => {
    void leaveRuntime().catch(fail);
  });
el('export').addEventListener('click', () => {
  void exclusive(async () =>
    download(
      new Blob([JSON.stringify(await exportSaves(namespace))], { type: 'application/json' }),
      'nexus-underground-saves.json',
    ),
  ).catch(fail);
});
el('backup').addEventListener('click', () => {
  void exclusive(async () => {
    await makeBackup(namespace);
    await refresh();
    say('Локальная резервная копия создана.');
  }).catch(fail);
});
el('restore').addEventListener('click', () => {
  void exclusive(async () => {
    await importSaves(
      namespace,
      await backupFile(namespace, el<HTMLSelectElement>('backups').value),
      { replace: true },
    );
    await refresh();
    say('Резервная копия восстановлена.');
  }).catch(fail);
});
el<HTMLInputElement>('save-input').addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file)
    void exclusive(async () => {
      await importSaves(namespace, file);
      await refresh();
      say('Сохранения импортированы. Предыдущее состояние сохранено в резервной копии.');
    }).catch(fail);
});
for (const id of ['resolution', 'fps', 'sound'])
  el(id).addEventListener('change', () => {
    void exclusive(() => preferences()).catch(fail);
  });
el('persist').addEventListener('click', () => {
  void navigator.storage
    .persist()
    .then((ok) =>
      say(
        ok
          ? 'Браузер разрешил постоянное локальное хранение.'
          : 'Браузер может освобождать место. Экспортируйте важные сохранения.',
      ),
    )
    .catch(fail);
});
function initialize(payload: unknown) {
  if (initialized) return;
  const init = initSchema.safeParse(payload);
  if (!init.success) return;
  namespace = init.data.namespace;
  initialized = true;
  void measureRefresh(30).then((rate) => {
    displayHz = rate.hz;
  });
  setPadPreferences(init.data.controls);
  const config = controllerConfigSchema.safeParse(init.data.controls);
  el('controller').textContent = config.success
    ? 'Профиль кнопок и стиков NEXUS подключён. Физические Xbox / DualSense / DS4 требуют отдельной проверки.'
    : 'Стандартная схема Gamepad API. Совместимость с физическими контроллерами не сертифицирована.';
  el('setup').hidden = false;
  void check()
    .then(async (storageAllowed) => {
      if (storageAllowed) {
        await preferences(true);
        await refresh();
      }
    })
    .catch(fail);
}
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== parentOrigin || window.parent === window)
    return;
  const parsed = bridgeSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.nonce !== nonce || parsed.data.type !== 'init') return;
  initialize(parsed.data.payload);
});
window.addEventListener('pagehide', () => {
  boot?.abort();
  session?.terminate();
});
if (
  directLaunch &&
  parentOrigin &&
  parentOrigin !== '__NEXUS_ORIGIN__' &&
  new URL(parentOrigin).origin === parentOrigin
)
  initialize(directLaunch.context);
else if (
  !parentOrigin ||
  window.parent === window ||
  !bridgeSchema.safeParse({ protocol: 'nexus-nfsu', version: 1, nonce, type: 'ready' }).success
)
  say('Откройте Underground через библиотеку NEXUS.');
else send('ready', { upstreamRevision: UPSTREAM_REVISION });
