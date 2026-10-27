// Export only real, completed runtime captures and measured physics results.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = 'public/reports/racing-experience',
  read = async (name) => JSON.parse(await fs.readFile(root + '/' + name, 'utf8'));
const low = await read('capture-low-video.json'),
  high = await read('capture-high-stills.json'),
  ultra = await read('capture-ultra-stills.json'),
  garage = await read('capture-high-garage.json'),
  online = await read('capture-online-two-clients.json');
assert(low.passed && high.passed && ultra.passed && garage.passed && online.passed);
assert.equal(low.scenes.length, 4);
assert.equal(high.scenes.length, 4);
assert(ultra.scenes.length >= 1);
const engineNames = {
  'meridian-r6': 'Meridian R6',
  'pocket-gt': 'Pocket GT',
  'iron-v8': 'Iron V8',
  'vector-rs': 'Vector RS',
  'apex-r': 'Apex R',
  'nova-x': 'Nova X',
};
const engines = await Promise.all(
  Object.entries(engineNames).map(async ([vehicleId, name]) => {
    const report = await read(`capture-low-video-${vehicleId}.json`);
    assert(report.passed && report.scenes.length === 1);
    assert.equal(report.scenes[0].audio.status, 'running');
    assert(report.scenes[0].audio.rms > 0);
    return { vehicleId, name, report };
  }),
);
const resources = [];
for (const report of [low, high, ultra, garage, online, ...engines.map((e) => e.report)])
  for (const scene of report.scenes) {
    for (const filename of [scene.screenshot, scene.clip].filter(Boolean)) {
      assert(!filename.includes('..'));
      const data = await fs.readFile(root + '/' + filename);
      resources.push({
        filename,
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
      if (filename.endsWith('.mp4')) {
        const probe = JSON.parse(
          execFileSync(
            'ffprobe',
            [
              '-v',
              'error',
              '-show_entries',
              'format=duration:stream=codec_type,width,height',
              '-of',
              'json',
              root + '/' + filename,
            ],
            { encoding: 'utf8' },
          ),
        );
        if (report.mode === 'two-client-functional-video')
          assert(!probe.streams.some((s) => s.codec_type === 'audio'));
        else assert(probe.streams.some((s) => s.codec_type === 'audio'));
        assert(Number(probe.format.duration) > 5);
      }
    }
  }
const mean = (a) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
const metrics = [];
for (const report of [low, high, ultra])
  for (const scene of report.scenes) {
    const frames = scene.stats.flatMap((x) => x.frameTimesMs).sort((a, b) => a - b),
      last = scene.stats.at(-1);
    if (!last || !frames.length) continue;
    metrics.push({
      route: scene.route,
      quality: report.quality,
      captureMode: report.mode,
      samples: frames.length,
      averageFps: 1000 / mean(frames),
      onePercentLowFps: 1000 / mean(frames.slice(-Math.max(1, Math.ceil(frames.length * 0.01)))),
      frameMeanMs: mean(frames),
      frameP95Ms: frames[Math.ceil(frames.length * 0.95) - 1],
      frameMaxMs: frames.at(-1),
      physicsMsPerStep: mean(scene.stats.map((x) => x.physicsCpuMsPerStep)),
      renderSubmissionMs: mean(scene.stats.map((x) => x.renderCpuMs)),
      drawCalls: last.drawCalls,
      gpuFrameMs: last.gpuFrameMs,
      gpuMemory: last.gpuMemory,
      backingPixelRatio: last.pixelRatio,
    });
  }
const summary = {
  date: new Date().toISOString(),
  passed: true,
  scope:
    'Actual browser runtime screenshots and live game-audio recordings. Shared 5-vCPU SwiftShader runner, capture overhead and concurrent functional QA; not a standalone gaming-PC benchmark. High/Ultra are severely GPU limited here. 1080p/60 FPS on physical hardware is unverified.',
  host: low.host,
  metrics,
  twoClientRace: online.browserTest,
  engines: engines.map(({ vehicleId, report }) => ({
    vehicleId,
    sourceCommit: report.sourceCommit,
    audio: report.scenes[0].audio,
    clip: report.scenes[0].clip,
  })),
  resources,
};
await fs.writeFile(root + '/evidence.json', JSON.stringify(summary, null, 2) + '\n');
const physics = JSON.parse(
  await fs.readFile('docs/racing-experience/vehicle-benchmarks.json', 'utf8'),
).results;
const names = {
  'downtown-circuit': 'NEXUS City',
  'velocity-circuit': 'Velocity Circuit',
  'eagle-ridge': 'Eagle Ridge',
  'coastline-run': 'Coastline Run',
};
const fixed = (x) => Number(x).toFixed(Number(x) < 1 ? 2 : 1);
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MIDNIGHT OUTLAWS — Racing Experience</title><link rel="stylesheet" href="style.css"><body><main><a class="back" href="/">← NEXUS</a><p class="eyebrow">REAL RUNTIME CAPTURES</p><h1>MIDNIGHT<br>OUTLAWS</h1><p class="intro">Шесть автомобилей. Город, автодром, горный перевал и прибрежное шоссе. Записи получены из работающей игры с её настоящим звуком.</p><p class="notice">Тестовая среда использует программный GPU SwiftShader. Видеозапись Low не обеспечивает комфортный FPS; High/Ultra работают ещё медленнее. Это демонстрация функций и материалов. Целевые 60 FPS на игровом ПК не подтверждены.</p><figure><img src="images/garage-high.png" alt="Настоящий 3D-гараж"><figcaption>3D-гараж · реальные сравнительные параметры игровой физики.</figcaption></figure><div class="scene-grid">${high.scenes.map((s) => `<figure><img loading="lazy" src="${s.screenshot}" alt="${names[s.route]}"><figcaption>${names[s.route]} · High · игровой runtime, 1280×720.</figcaption></figure>`).join('')}${ultra.scenes.map((s) => `<figure><img loading="lazy" src="${s.screenshot}" alt="${names[s.route]} Ultra"><figcaption>${names[s.route]} · Ultra.</figcaption></figure>`).join('')}</div><h2>Игровой процесс и звук</h2><p>Реальное время записи сохранено. Кадры не ускорены, плавность не дорисована. Видео захватывает игровой canvas; HUD виден на скриншотах. Звук — оригинальный многослойный синтез, а не профессиональные записи двигателей.</p><div class="scene-grid">${low.scenes.map((s) => `<figure><video controls preload="metadata" poster="${s.screenshot}" src="${s.clip}"></video><figcaption>${names[s.route]} · Low · живое управление и игровой звук.</figcaption></figure>`).join('')}</div><h2>Два независимых клиента</h2><p>Настоящая гонка Pocket GT и Iron V8 на Velocity Circuit: общий старт, контрольные точки, серверный финиш, сохранённые результаты и повторный заезд. Слева и справа — два отдельных процесса Chromium на локальном Colyseus. Для функциональной проверки использован Low/DPR 0.15; это не демонстрация качества графики. Запись без звука, скорость не изменена. Проверки публичного WSS описаны отдельно в отчёте релиза.</p><video controls preload="metadata" poster="${online.scenes[0].screenshot}" src="${online.scenes[0].clip}"></video><h2>Шесть машин — шесть звуковых профилей</h2><p>Записи работающего автомобиля на Velocity Circuit. Одинаковый маршрут, разные конфигурации физики и двигателя. Это живой игровой звук; качество записи ограничено программным GPU. Управление использует ограничение тестовой скорости, поэтому эти клипы не заменяют измерения разгона.</p><div class="scene-grid">${engines.map(({ name, report }) => `<figure><video controls preload="metadata" poster="${report.scenes[0].screenshot}" src="${report.scenes[0].clip}"></video><figcaption>${name} · Low · оригинальный звуковой профиль.</figcaption></figure>`).join('')}</div><h2>Измерения в этой среде</h2><p>${low.host.cpu} · ${low.host.logicalCpus} логических CPU · ${low.host.gpu}. Viewport 1280×720, DPR устройства 1. В Low внутренний DPR 0.85; показатели включают накладные расходы записи. GPU timer и видеопамять недоступны.</p><div class="table-wrap"><table><thead><tr><th>Трасса</th><th>Качество</th><th>FPS</th><th>1% low</th><th>Средний кадр</th><th>p95</th><th>Физика/шаг</th><th>Draw calls</th></tr></thead><tbody>${metrics.map((m) => `<tr><td>${names[m.route]}</td><td>${m.quality}</td><td>${fixed(m.averageFps)}</td><td>${fixed(m.onePercentLowFps)}</td><td>${fixed(m.frameMeanMs)} ms</td><td>${fixed(m.frameP95Ms)} ms</td><td>${m.physicsMsPerStep.toFixed(3)} ms</td><td>${m.drawCalls}</td></tr>`).join('')}</tbody></table></div><h2>Различия автомобилей</h2><p>Измерено в игровой физике на ровной сухой поверхности, без нитро. Это характеристики вымышленных игровых машин.</p><div class="table-wrap"><table><thead><tr><th>Автомобиль</th><th>0–100</th><th>0–200</th><th>Максимум</th><th>100–0</th></tr></thead><tbody>${physics.map((v) => `<tr><td>${v.vehicleId}</td><td>${v.zeroTo100Seconds.toFixed(2)} s</td><td>${v.zeroTo200Seconds?.toFixed(2) ?? '—'} s</td><td>${fixed(v.maximumSpeedKmh)} km/h</td><td>${fixed(v.braking100Meters)} m</td></tr>`).join('')}</tbody></table></div><h2>Ограничения</h2><p>Пять новых моделей и окружение Kenney стилизованы и требуют более детализированных замен для заявленного визуального ориентира. Профессиональные записи двигателей, кабина с интерьером, прыжки/перевороты и погода не реализованы. Публичные столкновения автомобилей отключены; приватный контактный режим ограничен городскими маршрутами. Физические контроллеры и игровой GPU не проверены.</p><p>Сопоставимые кадры «до» с той же камерой не сохранены; визуальное сравнение Before/After не подменяется чужими изображениями.</p><p>Car Concept — Eric Chadwick / Darmstadt Graphics Group, CC BY 4.0 (концепция Unity Fan; изменены материалы, подготовлены LOD, удалены эмблемы). Amazon Lumberyard Bistro — Amazon Lumberyard, CC BY 4.0; порт Logan Preshaw, изменения John James Gutib. HDRI — Poly Haven, CC0. Kenney Car/Racing/Nature Kits — CC0. Звук и трассы — оригинальная работа NEXUS.</p><p><a href="/game-assets/manifest.json">Исходные лицензии и изменения</a> · <a href="/game-assets/vehicle-manifest.json">Лицензии автомобилей</a> · <a href="/game-assets/track-manifest.json">Лицензии окружения</a> · <a href="evidence.json">Фактические измерения и хеши файлов</a></p><a class="launch" href="/play/midnight-outlaws">Запустить игру →</a></main></body></html>`;
await fs.writeFile(root + '/index.html', html);
await fs.writeFile(
  root + '/style.css',
  `*{box-sizing:border-box}body{margin:0;background:#0b1116;color:#e5ecdf;font:15px/1.7 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:40px 28px 90px}a{color:#d4e7ac}h1{font-size:clamp(45px,9vw,110px);line-height:.95;letter-spacing:-.055em;margin:35px 0}h2{font-size:28px;font-weight:500;margin-top:50px}.eyebrow{letter-spacing:.18em;font-size:11px;color:#b0c490;margin-top:55px}.intro{font-size:20px;max-width:780px}.notice{padding:20px;border:1px solid #7a674b;background:#2d271c;color:#e5d3a8}figure{margin:25px 0}img,video{display:block;width:100%;height:auto;border-radius:5px;background:#172126}figcaption{font-size:12px;color:#a6b4a7;margin-top:8px}.scene-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:12px;border-bottom:1px solid #ffffff20;white-space:nowrap}th{color:#b7cba2}.launch{display:inline-block;margin-top:25px;padding:14px 25px;background:#d3e8ac;color:#142019;border-radius:4px;text-decoration:none}@media(max-width:720px){main{padding:25px 16px}.scene-grid{grid-template-columns:1fr}}`,
);
console.log(
  JSON.stringify({ exported: true, metrics: metrics.length, resources: resources.length }),
);
