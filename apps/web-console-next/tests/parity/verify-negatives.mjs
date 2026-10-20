import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runCli } from '../run-cli.mjs';

const require = createRequire(import.meta.url);
process.env.PARITY_NEGATIVE = 'true';
process.env.PARITY_REPORT_DIR = resolve('test-results/parity/negative');
const result = await runCli([require.resolve('@playwright/test/cli'), 'test', '--config', 'tests/parity/playwright.config.mjs']);
const report = JSON.parse(await readFile(resolve(process.env.PARITY_REPORT_DIR, 'results.json'), 'utf8'));
const specs = [];
function collect(suite) { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) collect(child); }
collect(report);
const expected = new Map([
  ['unmatched request names method and path', /POST \/v1\/synthetic-unmatched/],
  ['unregistered request fails with page endpoints', /GET \/v1\/synthetic-page-unregistered/],
  ['external request fails even for a registered endpoint path', /GET \/v1\/synthetic-records/],
  ['runtime-health console.error', /runtime-health:.*synthetic-console-error/s],
  ['runtime-health pageerror', /runtime-health:.*synthetic-page-error/s],
  ['runtime-health unhandledrejection', /runtime-health:.*synthetic-rejection/s],
  ['runtime-health securitypolicyviolation', /runtime-health:.*synthetic-directive/s],
  ['runtime-health React #426', /runtime-health:.*#426/s],
  ['accessibility serious violation', /accessibility: serious\/critical axe violations[\s\S]*image-alt/],
  ['data missing manifest field', /data: synthetic missing field/],
  ...['method', 'path', 'body'].map((field) => [`action wrong ${field}`, /action: sign out expected/]),
  ['error-empty missing declared state', /error-empty: workspaces empty/],
  ['responsive 400px at 375px', /responsive: horizontal overflow at 375px/],
  ['visual-review one pixel differs', /1 pixels \(ratio [^)]*\) are different/],
  ...['catalogue', 'raw key', 'kit copy', 'accessible name', 'title', 'placeholder'].map((name) => [`locale ${name}`, /locale: unexpected copy/]),
  ['kit-conformance raw colour', /kit-conformance:.*semantic colour/s],
]);
assert.equal(result.status, 1, `Negative suite must exit non-zero: ${result.stderr}`);
assert.deepEqual(report.errors, [], 'No infrastructure errors may stand in for seeded failures');
assert.equal(specs.length, expected.size, 'Every seeded failure must execute');
for (const [name, symptom] of expected) {
  const spec = specs.find((s) => s.title === name);
  assert.ok(spec, `Missing negative test: ${name}`);
  assert.equal(spec.tests.length, 1, name);
  const test = spec.tests[0];
  assert.equal(test.status, 'unexpected', `Seed did not fail: ${name}`);
  assert.equal(test.results.length, 1, name);
  assert.equal(test.results[0].status, 'failed', name);
  assert.match(test.results[0].errors.map((e) => e.message).join('\n'), symptom, `Wrong failure for ${name}`);
  assert.ok(test.results[0].attachments.some((a) => a.name === 'trace'), `Missing failure trace: ${name}`);
}
console.log(`All ${expected.size} seeded parity faults failed with the expected symptoms; reports and traces retained.`);
