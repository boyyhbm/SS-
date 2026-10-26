// Publish only completed, real captures. No generated placeholder artwork.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = 'docs/graphics-next',
  out = 'public/reports/midnight-graphics';
const read = async (name) => JSON.parse(await fs.readFile(root + '/' + name, 'utf8'));
const high = await read('free-high-verified/still-report.json'),
  ultra = await read('free-ultra-verified/still-report.json'),
  video = await read('video-pad/video-report.json'),
  perf = await read('metrics/performance-report.json');
assert(
  high.passed && ultra.passed && video.passed && perf.passed,
  'Only successful captures may be published',
);
assert.equal(perf.results.length, 6, 'All requested preset measurements must exist');
for (const [name, capture] of Object.entries({ high, ultra })) {
  assert.equal(capture.capture?.deviceScaleFactor, 1, name + ' must use native-resolution capture');
  assert.equal(capture.capture?.width, 1280);
  assert.equal(capture.capture?.height, 720);
}

const settings = await read('settings/settings-report.json');
assert(settings.passed, 'Pause settings must fit desktop and mobile');
const mean = (a) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
const rows = perf.results.map((r) => {
  const windows = r.samples.filter((x) => !x.paused),
    frames = windows
      .flatMap((x) => x.frameTimesMs ?? [])
      .filter((x) => Number.isFinite(x) && x > 0),
    sorted = [...frames].sort((a, b) => a - b);
  assert(frames.length >= 2, 'No active timing samples: ' + r.requestedQuality);
  const last = windows.at(-1),
    worst = sorted.slice(-Math.max(1, Math.ceil(sorted.length * 0.01)));
  return {
    requested: r.requestedQuality,
    selected: last.quality,
    frameSamples: frames.length,
    fps: 1000 / mean(frames),
    frameMs: mean(frames),
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    frameSpikesOver50Ms: frames.filter((n) => n > 50).length,
    frameSpikesOver33Ms: frames.filter((n) => n > 33.333).length,
    mainThreadFrameMs: mean(windows.map((s) => s.frameMainThreadMs)),
    physicsSteps: windows.reduce((n, s) => n + s.physicsSteps, 0),
    assetLoadMs: last.loadMs,
    onePercentLow: frames.length >= 100 ? 1000 / mean(worst) : null,
    insufficientForOnePercentLow: frames.length < 100,
    drawCalls: mean(windows.map((s) => s.drawCalls)),
    renderMainThreadMs: mean(windows.map((s) => s.renderCpuMs)),
    physicsMsPerStep: mean(windows.map((s) => s.physicsCpuMsPerStep)),
    gpuFrameMs: windows.some((s) => s.gpuFrameMs !== null)
      ? mean(windows.filter((s) => s.gpuFrameMs !== null).map((s) => s.gpuFrameMs))
      : null,
    gpuMemory: 'UNAVAILABLE_WEBGL',
    dprRange: [
      Math.min(...windows.map((s) => s.pixelRatio)),
      Math.max(...windows.map((s) => s.pixelRatio)),
    ],
    gpu: r.gpu,
    viewport: r.viewport,
    canvas: r.canvas,
  };
});
const summary = {
  date: perf.date,
  machine: perf.machine,
  scope:
    'Actual game, software Vulkan/SwiftShader; no physical GPU or target 60 FPS certification. Short rows do not establish a reliable 1% low.',
  rows,
};
await fs.writeFile(root + '/performance-summary.json', JSON.stringify(summary, null, 2) + '\n');
const table = [
  '| Пресет | Фактический | Canvas | Кадры | FPS | Кадр, мс | P95, мс | 1% low |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(
    (r) =>
      `| ${r.requested} | ${r.selected} | ${r.canvas.join(' × ')} | ${r.frameSamples} | ${r.fps.toFixed(2)} | ${r.frameMs.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.onePercentLow === null ? 'недостаточно кадров' : r.onePercentLow.toFixed(2)} |`,
  ),
];
await fs.writeFile(
  root + '/performance.md',
  '# Реальные программные замеры\n\n' +
    summary.scope +
    '\n\n' +
    table.join('\n') +
    '\n\nЭто не игровой ПК. GPU frame time и VRAM недоступны через предоставленный WebGL API. Render main-thread duration включает ожидания драйвера; показатели не выдаются за чистое CPU/GPU время. Сырые кадры и размеры canvas сохранены в performance-report.json.\n',
);
await fs.mkdir(out, { recursive: true });
const copies = {
  'gameplay.mp4': 'gameplay.mp4',
  'gameplay-keyboard.mp4': 'keyboard.mp4',
  'video-pad/acceleration.png': 'video-frame.png',
  'free-high-verified/gameplay.png': 'high.png',
  'free-ultra-verified/gameplay.png': 'ultra.png',
  'free-high-verified/car-close.png': 'car-close.png',
  'settings/pause-1280.png': 'pause.png',
  'before/downtown-1.png': 'before.png',
  'after-curated/high/downtown-1.png': 'after.png',
  'performance-summary.json': 'measurements.json',
  'metrics/performance-report.json': 'raw-measurements.json',
  'server-four-players.json': 'sdk-four-players.json',
  'server-six-players.json': 'sdk-six-players.json',
  'webgpu-probe.json': 'webgpu-probe.json',
};
for (const [source, dest] of Object.entries(copies))
  await fs.copyFile(path.join(root, source), path.join(out, dest));
const esc = (v) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const peak = video.routes[0].peakSpeedKmh.toFixed(1);
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MIDNIGHT OUTLAWS — графическое обновление</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#090b12;color:#f7f8fc;font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:40px 20px 80px}a{color:#a7baff}a:focus-visible{outline:3px solid #6b8cff;outline-offset:6px}header{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:64px}header strong{letter-spacing:.18em}h1{font-size:clamp(32px,6vw,64px);line-height:1.06;letter-spacing:-.045em;max-width:900px}h2{margin-top:64px;font-size:28px;line-height:1.2}p{max-width:850px;color:#b9c0d1}video,img{display:block;width:100%;height:auto;border-radius:12px;background:#10131d}video{aspect-ratio:16/9}figure{margin:24px 0}figcaption{font-size:14px;color:#9ba3b8;margin-top:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:12px;border-bottom:1px solid #293041;white-space:nowrap}th{color:#a7baff}footer{margin-top:64px;padding-top:24px;border-top:1px solid #293041;font-size:13px;color:#9ba3b8}@media(max-width:700px){header{margin-bottom:36px}.pair{grid-template-columns:1fr}main{padding-top:24px}}
</style><main><header><strong>NEXUS</strong><a href="/">Открыть консоль</a></header><h1>MIDNIGHT OUTLAWS<br>Графическое обновление</h1><p>Настоящие кадры из работающего приложения: PBR-покрытие, полная модель автомобиля, локальные отражения, HDR и новые пресеты. Изображения не сгенерированы ИИ.</p>
<h2>Реальный заезд</h2><figure><video controls playsinline preload="metadata" poster="video-frame.png"><source src="gameplay.mp4" type="video/mp4"></video><figcaption>Виртуальный аналоговый геймпад, нитро, повороты и столкновение. Измеренный пик — ${esc(peak)} км/ч. Medium, DPR 0,5; запись на SwiftShader без физического GPU. Время воспроизведения не ускорено; частота кодирования видео не является FPS игры. <a href="keyboard.mp4">Заезд на клавиатуре</a>.</figcaption></figure>
<h2>Игра на High и Ultra</h2><div class="pair"><figure><img src="high.png" alt="Реальная свободная езда в MIDNIGHT OUTLAWS на High" loading="lazy"><figcaption>High · настоящий игровой runtime, 1280 × 720, DPR 1. До места съёмки машина доехала на Low / DPR 0,15, затем качество изменено через настоящее меню паузы.</figcaption></figure><figure><img src="ultra.png" alt="Реальная свободная езда в MIDNIGHT OUTLAWS на Ultra" loading="lazy"><figcaption>Ultra · полный исходный район и нативные normal maps, GTAO. Кадр после переключения настоящего меню графики; это не заявка на 60 FPS.</figcaption></figure></div><div class="pair"><figure><img src="car-close.png" alt="Автомобиль крупным планом" loading="lazy"><figcaption>Рабочая Close Chase Camera.</figcaption></figure><figure><img src="pause.png" alt="Меню паузы NEXUS" loading="lazy"><figcaption>Доступные настройки в настоящем меню паузы. Функциональный снимок на Low; кадры High и Ultra показаны выше.</figcaption></figure></div>
<h2>До / после: одинаковая проверочная камера</h2><p>Эта пара — фиксированные позы настоящего 3D-рендера для сравнения материалов и композиции. Она не выдаётся за заезд или доказательство мультиплеера.</p><div class="pair"><figure><img src="before.png" alt="Предыдущий графический конвейер, фиксированная камера" loading="lazy"><figcaption>До.</figcaption></figure><figure><img src="after.png" alt="Новый графический конвейер, та же фиксированная камера" loading="lazy"><figcaption>После.</figcaption></figure></div>
<h2>Замеры графического обновления</h2><p>Эта таблица измерена до последующей оптимизации CPU-запросов дорожных коллизий. Она не выдаётся за повторный FPS-тест после кэширования геометрии дороги.</p><p>Программный Vulkan / SwiftShader, ${esc(perf.machine.cpu)}, ограничение CPU ${esc(perf.machine.cpuQuota ?? perf.machine.quota)}. Это облачный runner без игровой видеокарты. Целевые High / 1080p / 60 FPS на игровом ПК требуют отдельной аппаратной проверки.</p><div class="table"><table><thead><tr><th>Пресет</th><th>Фактический</th><th>Canvas</th><th>Кадры</th><th>FPS</th><th>Кадр, мс</th><th>P95, мс</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.requested)}</td><td>${esc(r.selected)}</td><td>${esc(r.canvas.join(' × '))}</td><td>${r.frameSamples}</td><td>${r.fps.toFixed(2)}</td><td>${r.frameMs.toFixed(1)}</td><td>${r.p95Ms.toFixed(1)}</td></tr>`).join('')}</tbody></table></div><p><a href="measurements.json">Сводные измерения</a> · <a href="raw-measurements.json">сырые интервалы кадров и окружение</a>. Для коротких выборок 1% low не объявляется достоверным. GPU timing / VRAM недоступны в этом окружении.</p>
<h2>Границы этой версии</h2><p>WebGL 2 сохранён после проверки несовместимости существующих GLSL-материалов с WebGPU. SSR, TAA, ray tracing, полноценный салон и baked GI не заявляются. В городе остаются упрощённые участки и глухие фасады. Публичные соревновательные контакты машин отключены; физические USB/Bluetooth-контроллеры в этой среде не проверялись.</p><p>Авторизация, библиотека, друзья, сохранения и серверные результаты сохранены. Сетевые тесты с <a href="sdk-four-players.json">четырьмя</a> и <a href="sdk-six-players.json">шестью</a> настоящими SDK-клиентами проверяют сеть и результаты, а не GPU-производительность.</p>
<footer>Автомобиль Car Concept — Eric Chadwick / Darmstadt Graphics Group GmbH, концепция Unity Fan, <a href="/game-assets/licenses/car-source.md">CC BY 4.0</a>. Bistro — Amazon Lumberyard, Logan Preshaw, Jamsers, <a href="/game-assets/licenses/Bistro-attribution.txt">CC BY 4.0</a>. HDRI — Poly Haven / HDRI Haven, CC0. Three.js — MIT; Basis Universal — Apache-2.0. Нативные источники ограничивают разрешение текстур; апскейлинг за новую детализацию не выдаётся.</footer></main></html>`;
await fs.writeFile(out + '/index.html', html);
console.log('Completed real graphics evidence exported to ' + out);
