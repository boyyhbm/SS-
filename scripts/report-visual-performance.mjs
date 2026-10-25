import { readFile, writeFile } from 'node:fs/promises';
const root = 'docs/visual-overhaul';
const mean = (a) => a.reduce((sum, n) => sum + n, 0) / a.length;
const rows = [];
for (const quality of ['low', 'medium', 'high', 'auto']) {
  const report = JSON.parse(await readFile(`${root}/performance-${quality}.json`, 'utf8'));
  const active = report.samples.filter((s) => !s.paused && s.frameMs > 0).slice(2);
  if (active.length < 5 || report.errors.length)
    throw Error(`Insufficient clean measurements: ${quality}`);
  const last = active.at(-1),
    metric = (name) => report.cdpMetrics.find((m) => m.name === name)?.value;
  const frameTimes = active.flatMap((s) => s.frameTimesMs ?? []).sort((a, b) => a - b);
  if (!frameTimes.length) throw Error(`No raw frame times: ${quality}`);
  rows.push({
    requested: quality,
    actual: last.quality,
    samples: active.length,
    meanWindowFps: mean(active.map((s) => s.fps)),
    observedFps: 1000 / mean(frameTimes),
    meanFrameMs: mean(frameTimes),
    frameP95Ms: frameTimes[Math.max(0, Math.ceil(frameTimes.length * 0.95) - 1)],
    meanWindowFrameMs: mean(active.map((s) => s.frameMs)),
    worstWindowP95Ms: Math.max(...active.map((s) => s.frameP95Ms)),
    meanRenderCpuMs: mean(active.map((s) => s.renderCpuMs)),
    meanDrawCalls: mean(active.map((s) => s.drawCalls)),
    maxTriangles: Math.max(...active.map((s) => s.triangles)),
    textures: last.textures,
    geometries: last.geometries,
    pixelRatioRange: [
      Math.min(...active.map((s) => s.pixelRatio)),
      Math.max(...active.map((s) => s.pixelRatio)),
    ],
    assetsDecodedMiB: last.resourceDecodedBytes / 1048576,
    assetsLoadMs: last.loadMs,
    sceneReadyMs: report.sceneReadyMs,
    jsHeapUsedMiB: metric('JSHeapUsedSize') / 1048576,
    jsHeapTotalMiB: metric('JSHeapTotalSize') / 1048576,
    gpuProcessRssMiB: report.processMemory?.find((p) => /gpu/i.test(p.type))?.rssKiB / 1024,
    finalSpeedKmh: report.finalSpeedKmh,
    gpu: report.gpu,
    browser: report.browser,
    viewport: report.viewport,
  });
}
await writeFile(`${root}/performance-summary.json`, JSON.stringify(rows, null, 2));
const table = [
  '| Режим | FPS | Кадр, мс | P95 кадра, мс | Draw calls | JS heap, MiB | Ассеты, MiB | Готовность сцены, с |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(
    (r) =>
      `| ${r.requested} → ${r.actual} | ${r.observedFps.toFixed(1)} | ${r.meanFrameMs.toFixed(1)} | ${r.frameP95Ms.toFixed(1)} | ${r.meanDrawCalls.toFixed(0)} | ${r.jsHeapUsedMiB.toFixed(1)} | ${r.assetsDecodedMiB.toFixed(2)} | ${(r.sceneReadyMs / 1000).toFixed(1)} |`,
  ),
].join('\n');
await writeFile(`${root}/performance-table.md`, table + '\n');
console.log(table);
