import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF_NAME, 'verification/fold-observer');
const source = '5bfa6c3478e0cea7b95cb173fb5e30de444701cd';
const origin = 'https://nexus-web-ylcv.onrender.com';
const file = 'docs/fold-zero/release-observer.json';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const report = {
  sourceCommit: source,
  updatedAt: '',
  stage: 'starting',
  passed: false,
  ci: null,
  media: [],
  health: null,
  error: null,
};
async function github(route) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${route}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(r.status, 200);
  return r.json();
}
let lastFingerprint = '';
async function publish() {
  const fingerprint = JSON.stringify({ ...report, updatedAt: '' });
  if (fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;
  report.updatedAt = new Date().toISOString();
  await fs.mkdir('docs/fold-zero', { recursive: true });
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  execFileSync('git', ['config', 'user.name', 'NEXUS verification']);
  execFileSync('git', ['config', 'user.email', 'nexus-verification@users.noreply.github.com']);
  execFileSync('git', ['add', file]);
  execFileSync('git', ['commit', '-m', `[skip ci] Record Fold release observer: ${report.stage}`], {
    stdio: 'ignore',
  });
  execFileSync('git', ['push', 'origin', 'HEAD:verification/fold-observer'], { stdio: 'ignore' });
}
const started = Date.now();
try {
  while (Date.now() - started < 65 * 60000) {
    const runs = await github('actions/runs?head_sha=' + source + '&event=push&per_page=30');
    const ci = runs.workflow_runs.find((r) => r.name === 'NEXUS checks');
    if (ci) {
      const jobs = await github('actions/runs/' + ci.id + '/jobs');
      report.ci = {
        id: ci.id,
        url: ci.html_url,
        status: ci.status,
        conclusion: ci.conclusion,
        jobs: jobs.jobs.map((j) => ({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          steps: j.steps.map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
        })),
      };
      report.stage = 'release-checks';
      await publish();
      if (ci.status === 'completed') {
        assert.equal(ci.conclusion, 'success', 'Release checks failed');
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50000));
  }
  assert.equal(report.ci?.conclusion, 'success', 'Release checks wait expired');
  const evidence = JSON.parse(await fs.readFile('public/reports/fold-zero/evidence.json', 'utf8'));
  const products = [
    {
      filename: 'index.html',
      sha256: hash(await fs.readFile('public/reports/fold-zero/index.html')),
    },
    ...evidence.resources,
  ];
  while (Date.now() - started < 65 * 60000) {
    report.stage = 'public-media';
    let all = true;
    report.media = [];
    for (const p of products) {
      try {
        const r = await fetch(
          origin + '/reports/fold-zero/' + p.filename + '?verify=' + Date.now(),
          { cache: 'no-store', signal: AbortSignal.timeout(30000) },
        );
        const actual = r.ok ? hash(Buffer.from(await r.arrayBuffer())) : null;
        report.media.push({
          filename: p.filename,
          status: r.status,
          sha256MatchesSource: actual === p.sha256,
        });
        all &&= actual === p.sha256;
      } catch {
        all = false;
      }
    }
    const boot = await Promise.all(
      [origin + '/api/health', 'https://nexus-multiplayer.onrender.com/health'].map(async (url) => {
        try {
          const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
          const body = await r.json();
          return { url, status: r.status, ok: body.ok === true };
        } catch {
          return { url, ok: false };
        }
      }),
    );
    report.health = boot;
    if (all && boot.every((b) => b.ok)) {
      report.passed = true;
      report.stage = 'passed';
      await publish();
      break;
    }
    await publish();
    await new Promise((resolve) => setTimeout(resolve, 50000));
  }
  assert(report.passed, 'Public media wait expired');
} catch (e) {
  report.stage = 'failed';
  report.error = {
    name: e.name,
    message: e.name === 'AssertionError' ? e.message.split('\n')[0] : 'Observer request failed',
  };
  await publish();
  process.exitCode = 1;
}
