import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../apps/web-console-next/tests/run-cli.mjs';
import test from 'node:test';
import ParityReporter from '../../apps/web-console-next/tests/parity/reporter.mjs';

const run = (script, ...args) => runCli([`tests/parity/${script}`, ...args]);
test('fixture scanner rejects credential material and real IDs through its CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-scan-'));
  try {
    const cases = [
      ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature', 'JWT'],
      ['bearer', 'Bearer xyz', 'Bearer'],
      ['key', '-----BEGIN PRIVATE KEY-----', 'PRIVATE KEY'],
      ...['tenantId', 'workspaceId', 'userId', 'sessionId'].map((field) => [field, `${field}: 'tenant_alpha'`, 'synthetic-id']),
      ['yaml-id', 'tenantId: tenant_alpha', 'synthetic-id'],
      ['template-id', 'tenantId: `tenant_alpha`', 'synthetic-id'],
    ];
    for (const [name, text, rule] of cases) {
      const file = join(dir, `${name}.txt`); writeFileSync(file, text);
      const result = await run('scan-fixtures.mjs', file);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(file) && result.stderr.includes(rule), result.stderr);
    }
    const safe = join(dir, 'safe.txt');
    writeFileSync(safe, "tokenType: 'Bearer', tenantId: 'synthetic-tenant', workspaceId: `synthetic-workspace`, userId: synthetic-user, authorization: 'Bearer synthetic-token'");
    assert.equal((await run('scan-fixtures.mjs', safe)).status, 0);
    const defaults = await run('scan-fixtures.mjs');
    assert.equal(defaults.status, 0, defaults.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('manifest validation requires eight executable checks and rejects focused or disabled checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-validate-'));
  try {
    const checks = ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance'];
    const spec = checks.map((name) => `test('${name}', async () => { await check(); });`).join('\n');
    writeFileSync(join(dir, 'overview.manifest.ts'), 'export default {}');
    const file = join(dir, 'overview.spec.mjs');
    writeFileSync(file, spec);
    assert.equal((await run('validate.mjs', dir)).status, 0);
    for (const name of checks) {
      writeFileSync(file, spec.replace(`test('${name}', async () => { await check(); });`, ''));
      const result = await run('validate.mjs', dir);
      assert.equal(result.status, 1); assert.ok(result.stderr.includes(name), result.stderr);
      for (const modifier of ['skip', 'fixme', 'only']) {
        writeFileSync(file, spec.replace(`test('${name}'`, `test.${modifier}('${name}'`));
        assert.equal((await run('validate.mjs', dir)).status, 1);
      }
    }
    rmSync(file);
    assert.equal((await run('validate.mjs', dir)).status, 1);
    const defaults = await run('validate.mjs');
    assert.equal(defaults.status, 0, defaults.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a parity report certifies only complete all-passed eight-check groups', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-report-'));
  try {
    const names = ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance'];
    const input = join(dir, 'input.json');
    for (const [status, pass] of [['skipped', false], ['passed', true], ['failed', false]]) {
      writeFileSync(input, JSON.stringify(names.map((check, index) => ({ page: 'overview', role: 'tenant_owner', locale: 'es', check, status: index === 7 ? status : 'passed' }))));
      const result = await run('report.mjs', input);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.includes('PARITY_PASS'), pass, result.stdout);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the Playwright reporter never certifies skipped or unexpectedly passing checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-reporter-'));
  const previous = process.env.PARITY_REPORT_DIR;
  process.env.PARITY_REPORT_DIR = dir;
  try {
    const names = ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance'];
    for (const [expectedStatus, status, mapped, pass] of [
      ['skipped', 'skipped', 'skipped', false],
      ['failed', 'passed', 'unexpected', false],
      ['passed', 'passed', 'passed', true],
    ]) {
      const cases = names.map((title, index) => ({
        title, titlePath: () => ['overview | tenant_owner | es', title],
        expectedStatus: index === 7 ? expectedStatus : 'passed',
        results: [{ status: index === 7 ? status : 'passed', errors: [] }],
      }));
      const reporter = new ParityReporter();
      reporter.onBegin({}, { allTests: () => cases });
      reporter.onEnd({ status: 'passed' });
      const report = JSON.parse(readFileSync(join(dir, 'overview-tenant_owner-es.json'), 'utf8'));
      assert.equal(report.result === 'PARITY_PASS', pass);
      assert.equal(report.checks.find((row) => row.check === 'kit-conformance').status, mapped);
    }
  } finally {
    if (previous === undefined) delete process.env.PARITY_REPORT_DIR;
    else process.env.PARITY_REPORT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
