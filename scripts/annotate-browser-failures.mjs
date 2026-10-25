import { readFile } from 'node:fs/promises';
const escape = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const redact = (value) => String(value).replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>');
let report;
try { report = JSON.parse(await readFile('test-results/run-summary.json', 'utf8')); }
catch { console.log('Browser summary unavailable; see the preceding failed step.'); process.exit(0); }
let failed = 0;
function visit(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.at(-1);
      if (!result || !['failed', 'timedOut', 'interrupted'].includes(result.status)) continue;
      failed++;
      const firstLine = (result.error?.message ?? result.errors?.[0]?.message ?? result.status).split('\n')[0];
      // Full Playwright call logs can contain generated fixture passwords. Publish
      // only the static scenario title and redacted first error line.
      const message = redact(spec.title + ' — ' + firstLine).slice(0, 600);
      const file = String(spec.file ?? suite.file ?? '').replace(/^.*\/(tests\/e2e\/)/, '$1');
      console.log(`::error file=${escape(file)},line=${Number(spec.line ?? 1)},title=Browser scenario failed::${escape(message)}`);
    }
  }
  for (const nested of suite.suites ?? []) visit(nested);
}
for (const suite of report.suites ?? []) visit(suite);
console.log(`Browser failure summaries: ${failed}. Full private call logs were not printed.`);
