import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runCli } from '../run-cli.mjs';
import { scanTree, seededCheck } from './artifact-scan.mjs';

// The synthetic value the probe types. It is not a credential; the scanner must never find it on disk.
const canary = 'synthetic-canary-value-7f3a91c2';
const require = createRequire(import.meta.url);
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
process.env.PARITY_REPORT_DIR = resolve('test-results/parity/artifacts');
rmSync(process.env.PARITY_REPORT_DIR, { recursive: true, force: true });

// 1. Seeded canary: the scanner must find a planted value in each encoding and archive shape, and never print it.
seededCheck(canary);

// 2. Forced failure: value-bearing POST and PUT writes (failed, retried, aborted) followed by failing tests.
const result = await runCli([require.resolve('@playwright/test/cli'), 'test', '--config', 'tests/parity/artifacts.config.mjs']);
const report = JSON.parse(readFileSync(resolve(process.env.PARITY_REPORT_DIR, 'results.json'), 'utf8'));
const specs = [];
(function collect(suite) { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) collect(child); })(report);
assert.equal(result.status, 1, 'The probe must fail on purpose so failure artifacts exist');
assert.deepEqual(report.errors, [], 'No infrastructure error may stand in for the forced failure');
assert.equal(specs.length, 2, 'Both probes must run');
const messages = specs.map((spec) => spec.tests[0].results[0].errors.map((error) => error.message).join('\n'));
assert.match(messages[0], /value must be cleared/, 'The failing clear must name the field');
assert.match(messages[1], /forced probe failure/, 'The PUT probe must fail after its writes');
for (const text of [result.stdout, result.stderr, ...messages]) assert.ok(!String(text).includes(canary), 'No console output or report message may carry the value');

// 3. The on-disk scan: traces, HAR, request logs, error-context.md, screenshots and reports hold no value.
const scan = scanTree(process.env.PARITY_REPORT_DIR, [canary]);
assert.ok(scan.files > 0, 'The probe must leave artifacts to scan');
assert.deepEqual(scan.hits, [], `Secret value found in persisted artifacts: ${scan.hits.join(', ')}`);
console.log(`Scanned ${scan.files} persisted artifacts after forced failures: the synthetic secret value appears in none.`);
