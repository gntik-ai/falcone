import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../apps/web-console-next/tests/run-cli.mjs';
import test from 'node:test';

const run = (script, ...args) => runCli([`tests/parity/${script}`, ...args]);
test('fixture scanner rejects credential material and real IDs through its CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-scan-'));
  try {
    const cases = [
      ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature', 'JWT'],
      ['bearer', 'Bearer xyz', 'Bearer'],
      ['key', '-----BEGIN PRIVATE KEY-----', 'PRIVATE KEY'],
      ...['tenantId', 'workspaceId', 'userId', 'sessionId'].map((field) => [field, `${field}: 'tenant_alpha'`, 'synthetic-id']),
    ];
    for (const [name, text, rule] of cases) {
      const file = join(dir, `${name}.txt`); writeFileSync(file, text);
      const result = await run('scan-fixtures.mjs', file);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(file) && result.stderr.includes(rule), result.stderr);
    }
    const safe = join(dir, 'safe.txt');
    writeFileSync(safe, "tokenType: 'Bearer', tenantId: 'synthetic-tenant', authorization: 'Bearer synthetic-token'");
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
