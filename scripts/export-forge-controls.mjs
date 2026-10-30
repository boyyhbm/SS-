import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const r = JSON.parse(fs.readFileSync('docs/fold-controls/gameplay.json', 'utf8'));
if (!r.passed || !r.realVideo || r.recordedFiles.length !== 1 || !r.audioRecording)
  throw Error('Verified actual match footage required');
const start = Math.max(0, r.videoMatchStartSeconds - 1),
  duration = r.videoMatchEndSeconds - start + 2;
if (duration < 20 || duration > 700) throw Error('Unexpected footage duration');
const out = 'public/reports/fold-controls/duel.mp4';
fs.mkdirSync('public/reports/fold-controls', { recursive: true });
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    r.recordedFiles[0],
    '-itsoffset',
    String(r.audioRecording.offsetSeconds),
    '-i',
    r.audioRecording.path,
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
    '-threads',
    '2',
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
    out,
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
      out,
    ],
    { encoding: 'utf8' },
  ),
);
if (
  !probe.streams.some((s) => s.codec_type === 'audio') ||
  !probe.streams.some((s) => s.codec_type === 'video')
)
  throw Error('Both actual audio and video required');
const bytes = fs.readFileSync(out);
const report = {
  date: new Date().toISOString(),
  passed: true,
  filename: 'duel.mp4',
  durationSeconds: Number(probe.format.duration),
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  scope:
    'One uninterrupted actual five-round match between two independent authenticated browsers, automated normal keyboard/Pointer Lock and virtual Gamepad API inputs, real authoritative Fold transitions and persisted results. Original speed, live Web Audio bus from the same recording with approximate subsecond alignment. Reduced software-GPU backing resolution is disclosed; no frame interpolation, generated images or replacement soundtrack.',
  shots: r.observedShots,
  hits: r.observedHits,
  foldTransitions: r.foldTransitions,
};
fs.writeFileSync('docs/fold-controls/video-export.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    videoExported: true,
    durationSeconds: report.durationSeconds,
    bytes: bytes.length,
  }),
);
