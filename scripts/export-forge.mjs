import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const read = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const browser = await read('docs/fold-zero/browser.json'),
  capture = await read('docs/fold-zero/capture.json'),
  network = await read('docs/fold-zero/network.json');
assert(browser.passed && capture.passed && network.passed);
assert(
  browser.observedHits > 0 &&
    browser.realVideo &&
    browser.recordedFiles.length === 1 &&
    browser.audioRecording,
);
const dir = 'public/reports/fold-zero';
await fs.mkdir(dir, { recursive: true });
const start = Math.max(0, browser.videoMatchStartSeconds - 1),
  duration = browser.videoMatchEndSeconds - start + 2;
assert(duration > 20 && duration < 700);
// One uninterrupted match at actual wall-clock speed, with the live Web Audio
// bus from that same browser. Only menu/login edges are trimmed. No interpolation,
// sped-up playback, substitute soundtrack or pose injection is used.
const video = dir + '/first-duel.mp4';
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    browser.recordedFiles[0],
    '-itsoffset',
    String(browser.audioRecording.offsetSeconds),
    '-i',
    browser.audioRecording.path,
    '-ss',
    String(start),
    '-t',
    String(duration),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    video,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
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
      video,
    ],
    { encoding: 'utf8' },
  ),
);
assert(
  probe.streams.some((s) => s.codec_type === 'video') &&
    probe.streams.some((s) => s.codec_type === 'audio'),
);
const metrics = capture.presets.map((p) => ({
  quality: p.quality,
  viewport: p.viewport,
  renderBuffer: p.renderBuffer,
  gpu: p.gpu,
  sampleCount: p.samples.length,
  lastMeasuredWindow: p.samples.at(-1),
}));
const files = [];
for (const filename of ['first-duel.mp4', 'high-menu.png', 'ultra-menu.png']) {
  const b = await fs.readFile(dir + '/' + filename);
  files.push({ filename, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });
}
const evidence = {
  date: new Date().toISOString(),
  passed: true,
  stage: 'First playable development build; full visual/hardware acceptance incomplete',
  video: {
    filename: 'first-duel.mp4',
    durationSeconds: Number(probe.format.duration),
    scope:
      'Two independent authenticated browsers, virtual Gamepad API versus keyboard/Pointer Lock mouse events. A complete server-verified five-round match, recorded at original speed. Live synthesized game audio is muxed using captured wall-clock alignment; subsecond capture alignment is approximate. Software GPU, reduced backing resolution for functional verification; not a high-quality hardware capture.',
    shots: browser.observedShots,
    hits: browser.observedHits,
    finalRoundReason: browser.lastRoundReason,
  },
  hardware: capture.hardware,
  metrics,
  networkProfiles: network.cases.map((c) => c.profile),
  limits: [
    'Provisional original character, weapon, arena art and animations. Final premium art production is not complete.',
    'Actual software-GPU measurements are slow; physical gaming hardware 60/120 FPS is unverified. Native High/Ultra captures show the main-menu environment, not a combat benchmark.',
    'No physical controller, USB/Bluetooth or hardware audio-output certification.',
    'No WebGPU comparison, baked lighting, AO, dynamic resolution or full skeletal hitboxes in this stage.',
  ],
  resources: files,
};
await fs.writeFile(dir + '/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
const rows = metrics
  .map(
    (m) =>
      `<tr><td>${m.quality}</td><td>${m.renderBuffer.width}×${m.renderBuffer.height}</td><td>${m.lastMeasuredWindow.fps.toFixed(2)}</td><td>${m.lastMeasuredWindow.frameMs.toFixed(1)} ms</td><td>${m.lastMeasuredWindow.p99Ms.toFixed(1)} ms</td><td>${m.lastMeasuredWindow.drawCalls}</td></tr>`,
  )
  .join('');
await fs.writeFile(
  dir + '/index.html',
  `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FOLD: ZERO · First Playable</title><link rel="stylesheet" href="style.css"><body><header><a href="/">NEXUS / FORGE</a><span>DEVELOPMENT BUILD 01</span></header><main><p class="eyebrow">THE FOUNDRY · 1V1</p><h1>FOLD: ZERO</h1><p class="lead">Первый настоящий поединок. Два аккаунта, общая арена, серверные попадания и перестройка геометрии.</p><a class="play" href="/games/fold-zero">Открыть игру ↗</a><section><h2>Непрерывный матч</h2><p>Два независимых браузера с автоматизированным обычным вводом: виртуальный геймпад и клавиатура/мышь. Это тестовые клиенты, а не запись двух людей. Пять раундов, настоящий игровой звук, серверный результат и исходная скорость воспроизведения. Сниженное внутреннее разрешение; качество игрового ПК эта запись не подтверждает.</p><video controls preload="metadata" src="first-duel.mp4"></video></section><section><h2>Настоящий рендер · High / Ultra</h2><p>Снимки главного меню работающей игры при DPR 1. Графика и анимации первого этапа временные.</p><div class="images"><figure><img src="high-menu.png" alt="Главное меню и настоящая сцена THE FOUNDRY, High"><figcaption>HIGH · 1280×720</figcaption></figure><figure><img src="ultra-menu.png" alt="Главное меню и настоящая сцена THE FOUNDRY, Ultra"><figcaption>ULTRA · внутренний буфер 1536×864</figcaption></figure></div></section><section><h2>Измерения, без обещаний</h2><p>Xeon Platinum 8573C, 5 логических CPU, Chromium / SwiftShader. Короткие измерения сцены меню на программном GPU. GPU frame time и видеопамять недоступны. 60/120 FPS на игровом ПК не проверены. 1% low в overlay определяется обратной величиной p99 времени кадра.</p><div class="table"><table><thead><tr><th>Режим</th><th>Буфер</th><th>FPS</th><th>Средний кадр</th><th>p99</th><th>Draw calls</th></tr></thead><tbody>${rows}</tbody></table></div></section><section><h2>Что дальше</h2><p>Профессиональная художественная доработка персонажей, оружия и арены, анимации, дальнейшая звуковая полировка, баланс с людьми и измерения на физическом GPU/контроллерах. Первый играбельный этап не выдаётся за завершение всех требований.</p><a href="evidence.json">Фактические данные и хеши файлов ↗</a></section></main></body></html>`,
);
await fs.writeFile(
  dir + '/style.css',
  `*{box-sizing:border-box}body{margin:0;background:#18243e;color:#f4f2ea;font:15px/1.7 system-ui,sans-serif}header{display:flex;justify-content:space-between;gap:20px;padding:25px 6vw;border-bottom:1px solid #ffffff20;font-size:11px;letter-spacing:.12em}a{color:#55ddf4}header a{text-decoration:none;color:#f4f2ea}main{max-width:1280px;margin:auto;padding:55px 5vw}h1{font-size:clamp(48px,9vw,112px);line-height:1;letter-spacing:-.07em;margin:22px 0}h2{font-size:27px;letter-spacing:-.04em}.eyebrow{color:#55ddf4;font-size:11px;letter-spacing:.2em}.lead{max-width:680px;font-size:20px;color:#ccdbe3}.play{display:inline-block;margin-top:20px;padding:12px 25px;background:#55ddf4;color:#18243e;text-decoration:none;font-weight:700}section{margin-top:65px}section>p{color:#bbcad5;max-width:950px}video{width:100%;background:#0d1425;margin-top:15px}.images{display:grid;grid-template-columns:1fr 1fr;gap:22px}figure{margin:0}img{width:100%;display:block}figcaption{font-size:11px;color:#abc4d0;padding:10px 0}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:13px 18px;text-align:left;border-bottom:1px solid #ffffff20}th{color:#55ddf4}@media(max-width:700px){.images{grid-template-columns:1fr}header>span{display:none}}`,
);
console.log(
  JSON.stringify({
    passed: true,
    videoDuration: Number(probe.format.duration),
    files: files.length,
  }),
);
