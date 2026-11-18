import assert from 'node:assert/strict';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

test('the next-console CI job checks the scaffold and legacy release commands without publication or credentials', () => {
  const ci = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const job = ci.jobs['web-console-next'];
  assert.ok(job, 'web-console-next must run in the existing PR workflow');
  assert.equal(job.if, undefined);
  assert.equal(job.permissions, undefined);
  assert.equal(job.secrets, undefined);
  const commands = job.steps.filter((step) => step.run).map((step) => step.run);
  for (const command of [
    'pnpm install --frozen-lockfile',
    'pnpm --filter @in-falcone/web-console-next typecheck',
    'pnpm --filter @in-falcone/web-console-next test',
    'pnpm --filter @in-falcone/web-console-next lint:colours',
    'pnpm --filter @in-falcone/web-console-next check:i18n',
    'pnpm --filter @in-falcone/web-console-next lint:i18n',
    'pnpm --filter @in-falcone/web-console-next test:i18n',
    'node scripts/validate-gntik-ui-pin.mjs',
    'docker build -f apps/web-console/Dockerfile .',
  ]) assert.ok(commands.includes(command), `Missing CI check: ${command}`);
  assert.ok(commands.some((command) => command.includes('VITE_BASE_PATH=') && command.includes('/next/') && command.includes('web-console-next build')));
  const build = job.steps.find((step) => step.name === 'Build the next console at both base paths');
  assert.match(build.run, /web-console-next test:i18n-chunks/);
  for (const command of ['check:i18n', 'lint:i18n', 'test:i18n']) {
    const step = job.steps.find((step) => step.run === `pnpm --filter @in-falcone/web-console-next ${command}`);
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
  }

  const release = YAML.parse(readFileSync('.github/workflows/release-images.yml', 'utf8'));
  const releaseSteps = Object.values(release.jobs).flatMap((job) => job.steps ?? []);
  for (const step of releaseSteps.filter((step) => step.if === "matrix.build_spa == 'true'" && step.run)) {
    assert.ok(commands.includes(step.run), `Missing release-equivalent command: ${step.run}`);
  }
  const serialized = JSON.stringify(job);
  assert.doesNotMatch(serialized, /secrets\.|docker push|push:|login-action|registry-url/);
  assert.equal(ci.on.pull_request?.paths, undefined);
});

test('the next-console CSP step builds both bases and enforces the dist and Chromium checks', () => {
  const job = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs['web-console-next'];
  const step = job.steps.find((step) => step.name === 'Validate next-console CSP and self-hosted assets');
  assert.ok(step, 'CSP validation must be an enforced CI step');
  assert.equal(step.if, undefined);
  assert.equal(step.continueOnError, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.env, undefined);
  assert.match(step.run, /web-console-next exec playwright install --with-deps chromium/);
  assert.match(step.run, /node --test apps\/web-console-next\/tests\/validate-dist.test.mjs/);
  assert.match(step.run, /for base in \/ \/next\//);
  assert.match(step.run, /CSP_TEST_HARNESS=true.*web-console-next build/);
  assert.match(step.run, /web-console-next validate:dist/);
  assert.match(step.run, /VITE_BASE_PATH="\$base".*web-console-next test:csp/);
});

test('the shell step enforces release exclusion, fixture build and browser tests without changing legacy CI', () => {
  const ci = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const job = ci.jobs['web-console-next'];
  const shell = job.steps.find((step) => step.name === 'Test authenticated next-console shell');
  assert.ok(shell, 'The shell browser spec must be an enforced step');
  assert.equal(shell.if, undefined);
  assert.equal(shell['continue-on-error'], undefined);
  assert.match(shell.run, /SHELL_TEST_FIXTURES= VITE_BASE_PATH=\/next\/.*web-console-next build/);
  assert.match(shell.run, /node --test tests\/shell-release.test.mjs/);
  assert.match(shell.run, /SHELL_TEST_FIXTURES=true.*web-console-next build/);
  assert.match(shell.run, /web-console-next exec playwright test --config tests\/shell\/playwright.config.mjs/);
  assert.equal(ci.jobs['web-console'].steps.some((step) => /web-console-next/.test(step.run ?? '')), false);
  const unit = job.steps.find((step) => step.run === 'pnpm --filter @in-falcone/web-console-next test');
  assert.equal(unit.if, undefined);
  assert.equal(unit['continue-on-error'], undefined);
  const release = job.steps.find((step) => step.name === 'Build the next release SPA');
  assert.ok(!release.env.SHELL_TEST_FIXTURES);
});

function assertParityWorkflow(ci) {
  const names = ['ui-parity-structure', 'ui-parity-shards', 'ui-parity-negatives'];
  const structure = ci.jobs[names[0]];
  const shards = ci.jobs[names[1]];
  const negatives = ci.jobs[names[2]];
  const aggregate = ci.jobs['ui-parity'];
  assert.deepEqual(shards?.strategy, { 'fail-fast': false, matrix: { shard: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] } });
  for (const event of ['pull_request', 'push']) {
    assert.ok(Object.hasOwn(ci.on, event), `${event} must trigger parity`);
    assert.equal(ci.on[event]?.paths, undefined);
    assert.equal(ci.on[event]?.['paths-ignore'], undefined);
  }
  const original = ci.jobs['web-console-next'];
  const commands = (job) => job.steps.filter((s) => s.run).map((s) => s.run).join('\n');
  const inspect = (value, allowAlways = false) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'continue-on-error');
      if (key === 'if') assert.ok(allowAlways && child === 'always()', 'only uploads and the aggregate job may use if: always()');
      inspect(child);
    }
  };
  const artifactNames = [];
  for (const name of [...names, 'ui-parity']) {
    const job = ci.jobs[name];
    assert.ok(job, `${name} must run on every PR and push`);
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, `${name} needs a numeric timeout`);
    const { steps, ...properties } = job;
    inspect(properties, name === 'ui-parity');
    for (const step of steps) inspect(step, step.uses?.startsWith('actions/upload-artifact@'));
    assert.doesNotMatch(JSON.stringify(job), /secrets\.|cache.*browser|4173/);
    assert.ok(steps.every((s) => !s.uses || /^[^@]+@[a-f0-9]{40}$/.test(s.uses)), 'actions must be pinned');
    if (name === 'ui-parity') continue;
    assert.equal(job.needs, undefined, 'parity checks must run independently');
    for (const prefix of ['actions/checkout@', 'pnpm/action-setup@', 'actions/setup-node@']) {
      assert.equal(steps.find((s) => s.uses?.startsWith(prefix))?.uses, original.steps.find((s) => s.uses?.startsWith(prefix))?.uses);
    }
    assert.ok(commands(job).includes('pnpm install --frozen-lockfile'));
    const uploads = steps.filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(uploads.length, name === 'ui-parity-structure' ? 0 : 1);
    for (const upload of uploads) {
      assert.equal(upload.uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
      assert.equal(upload.if, 'always()');
      assert.equal(upload.with['retention-days'], 7);
      artifactNames.push(upload.with.name);
    }
  }
  for (const command of ['parity:scan', 'parity:validate', 'node --test tests/unit/web-console-next-ci.test.mjs', 'node --test tests/unit/parity-tools.test.mjs']) {
    assert.ok(commands(structure).includes(command), command);
  }
  for (const job of [shards, negatives]) {
    assert.ok(commands(job).includes('exec playwright install --with-deps chromium'));
    assert.match(commands(job), /SHELL_TEST_FIXTURES=true VITE_BASE_PATH=\/ pnpm --filter @in-falcone\/web-console-next build/);
  }
  const shardTest = shards.steps.find((step) => step.name === 'Test parity shard');
  assert.equal(shardTest?.run, 'pnpm --filter @in-falcone/web-console-next exec playwright test --config tests/parity/playwright.config.mjs --shard=${{ matrix.shard }}/16 --workers=3');
  assert.doesNotMatch(commands(shards), /--grep|--test-list|test:parity|verify-negatives/);
  assert.equal(negatives.strategy, undefined, 'seeded faults run once');
  assert.ok(commands(negatives).includes('pnpm --filter @in-falcone/web-console-next exec node tests/parity/verify-negatives.mjs'));
  assert.equal(names.flatMap((name) => commands(ci.jobs[name]).match(/verify-negatives\.mjs/g) ?? []).length, 1);
  const upload = (job) => job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@')).with;
  assert.equal(upload(shards).name, 'ui-parity-shard-${{ matrix.shard }}');
  assert.equal(upload(shards).path, 'apps/web-console-next/test-results/parity/');
  assert.equal(upload(negatives).name, 'ui-parity-negatives');
  assert.equal(upload(negatives).path, 'apps/web-console-next/test-results/parity/negative/');
  assert.equal(new Set(artifactNames).size, artifactNames.length);
  assert.deepEqual(aggregate.needs, names);
  assert.equal(aggregate.if, 'always()');
  assert.equal(aggregate.steps.length, 9, 'aggregate sets up, downloads, merges, uploads, then checks results');
  for (const prefix of ['actions/checkout@', 'pnpm/action-setup@', 'actions/setup-node@']) {
    assert.equal(aggregate.steps.find((s) => s.uses?.startsWith(prefix))?.uses, original.steps.find((s) => s.uses?.startsWith(prefix))?.uses);
  }
  assert.ok(commands(aggregate).includes('pnpm install --frozen-lockfile'));
  assert.match(commands(aggregate), /SHELL_TEST_FIXTURES=true VITE_BASE_PATH=\/ pnpm --filter @in-falcone\/web-console-next build/);
  const download = aggregate.steps.findIndex((s) => s.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download, 5);
  assert.deepEqual(aggregate.steps[download].with, {
    pattern: 'ui-parity-shard-*', path: 'apps/web-console-next/test-results/parity/shards',
  });
  const merge = aggregate.steps.findIndex((s) => s.name === 'Merge parity reports');
  assert.equal(merge, 6);
  assert.match(aggregate.steps[merge].run, /playwright test --config tests\/parity\/playwright.config.mjs --list --reporter=json/);
  assert.match(aggregate.steps[merge].run, /playwright merge-reports --config tests\/parity\/merge.config.mjs/);
  const report = aggregate.steps[7];
  assert.equal(report.uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  assert.equal(report.if, 'always()');
  assert.deepEqual(report.with, { name: 'ui-parity-report', path: 'apps/web-console-next/test-results/parity/', 'retention-days': 7 });
  const result = aggregate.steps.find((s) => s.name === 'Require every parity job to succeed');
  assert.equal(result, aggregate.steps.at(-1));
  assert.equal(result.uses, undefined);
  assert.deepEqual(result.env, {
    STRUCTURE_RESULT: '${{ needs.ui-parity-structure.result }}',
    SHARDS_RESULT: '${{ needs.ui-parity-shards.result }}',
    NEGATIVES_RESULT: '${{ needs.ui-parity-negatives.result }}',
  });
}

test('ui-parity is an unconditional isolated job with pinned actions and downloadable reports', () => {
  assertParityWorkflow(YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')));
  const config = readFileSync('apps/web-console-next/tests/parity/playwright.config.mjs', 'utf8');
  assert.match(config, /\bworkers: 1,/);
  assert.match(config, /\bretries: 0,/);
  assert.match(config, /fullyParallel: true/);
});

test('ui-parity structure checks reject coverage loss and a bypassed aggregate', () => {
  const mutations = [
    (jobs) => { jobs['ui-parity-shards'].strategy.matrix.shard.pop(); },
    (jobs) => { jobs['ui-parity-shards'].steps.find((s) => s.run?.includes('--shard=')).run = 'pnpm --filter @in-falcone/web-console-next exec playwright test --config tests/parity/playwright.config.mjs'; },
    (jobs) => { jobs['ui-parity-shards'].steps.find((s) => s.run?.includes('--shard=')).run += ' --shard=1/8'; },
    (jobs) => { delete jobs['ui-parity-shards'].steps.at(-1).if; },
    (jobs) => { jobs['ui-parity-shards'].steps.at(-1).with.name = 'ui-parity-negatives'; },
    (jobs) => { jobs['ui-parity'].needs.pop(); },
    (jobs) => { delete jobs['ui-parity'].if; },
    (jobs) => { jobs['ui-parity-negatives'].if = 'false'; },
    ...['ui-parity-structure', 'ui-parity-shards', 'ui-parity-negatives', 'ui-parity'].map((name) => (jobs) => { delete jobs[name]['timeout-minutes']; }),
    (jobs) => { jobs['ui-parity'].steps = jobs['ui-parity'].steps.filter((s) => s.name !== 'Merge parity reports'); },
    (jobs) => { jobs['ui-parity'].steps.find((s) => s.uses?.startsWith('actions/upload-artifact@')).with.name = 'wrong-report'; },
  ];
  for (const mutate of mutations) {
    const ci = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    mutate(ci.jobs);
    assert.throws(() => assertParityWorkflow(ci), { code: 'ERR_ASSERTION' });
  }
});

test('ui-parity aggregate rejects non-success jobs, missing tests, duplicates, retries and incomplete shard evidence', async () => {
  const job = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs['ui-parity'];
  const step = job.steps.find((s) => s.name === 'Require every parity job to succeed');
  const success = { STRUCTURE_RESULT: 'success', SHARDS_RESULT: 'success', NEGATIVES_RESULT: 'success' };
  const dir = mkdtempSync(join(tmpdir(), 'parity-ci-result-'));
  const root = join(dir, 'apps/web-console-next/test-results/parity');
  const expected = { errors: [], suites: [{ specs: [{ id: 'data', tests: [{ projectName: '', expectedStatus: 'passed', results: [] }] }], suites: [] }] };
  const merged = { ...expected, stats: { startTime: '2026-11-18T00:00:00Z', duration: 1000, expected: 1, unexpected: 0, skipped: 0, flaky: 0 } };
  merged.suites = structuredClone(expected.suites);
  merged.suites[0].specs[0].tests[0].results = [{ status: 'passed' }];
  const write = (name, value) => writeFileSync(join(root, name), JSON.stringify(value));
  const run = (results = success) => runProcess('bash', ['-e', '-c', step.run], dir, { ...results, GITHUB_STEP_SUMMARY: join(dir, 'summary.md') });
  try {
    mkdirSync(root, { recursive: true });
    write('expected.json', expected); write('results.json', merged);
    for (let shard = 1; shard <= 16; shard++) {
      mkdirSync(join(root, `shards/ui-parity-shard-${shard}/blob`), { recursive: true });
      write(`shards/ui-parity-shard-${shard}/results.json`, { stats: merged.stats });
      write(`shards/ui-parity-shard-${shard}/blob/report-${shard}.zip`, {});
    }
    assert.equal((await run()).status, 0);
    for (const key of Object.keys(success)) {
      for (const result of ['failure', 'cancelled', 'skipped', '']) {
        assert.equal((await run({ ...success, [key]: result })).status, 1, `${key}=${result}`);
      }
    }
    for (const mutate of [
      (report) => { report.suites = []; },
      (report) => { report.suites.push(structuredClone(report.suites[0])); },
      (report) => { report.suites[0].specs[0].id = 'another-test'; },
      (report) => { report.suites[0].specs[0].tests[0].results.push({ status: 'passed' }); },
      (report) => { report.suites[0].specs[0].tests[0].results[0].status = 'skipped'; },
      (report) => { report.errors.push({ message: 'merge infrastructure failure' }); },
    ]) {
      const report = structuredClone(merged); mutate(report); write('results.json', report);
      assert.equal((await run()).status, 1);
    }
    write('results.json', merged);
    rmSync(join(root, 'shards/ui-parity-shard-16'), { recursive: true });
    assert.equal((await run()).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// File-backed subprocess output also works in sandboxes that restrict child-process pipes.
const runNode = (args, cwd, env) => runProcess(process.execPath, args, cwd, env);
async function runProcess(executable, args, cwd, env = {}) {
  const output = mkdtempSync(join(tmpdir(), 'parity-ci-output-'));
  const out = openSync(join(output, 'stdout'), 'w'), err = openSync(join(output, 'stderr'), 'w');
  try {
    const status = await new Promise((done, reject) => {
      const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, err] });
      child.on('error', reject);
      child.on('close', done);
    });
    return { status, stdout: readFileSync(join(output, 'stdout'), 'utf8'), stderr: readFileSync(join(output, 'stderr'), 'utf8') };
  } finally {
    closeSync(out); closeSync(err); rmSync(output, { recursive: true, force: true });
  }
}

test('merged blob reports certify groups split across workers and shards and preserve every attachment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-ci-merge-'));
  const app = resolve('apps/web-console-next');
  const cli = join(app, 'node_modules/@playwright/test/cli.js');
  const reportPath = 'overview-tenant_owner-es.json';
  try {
    const config = join(dir, 'playwright.config.mjs');
    writeFileSync(config, `
      import original from ${JSON.stringify(join(app, 'tests/parity/playwright.config.mjs'))};
      export default {
        ...original, testDir: ${JSON.stringify(dir)}, testMatch: 'sample.spec.mjs',
        reporter: original.reporter.map(([name, options]) => [name === './reporter.mjs' ? ${JSON.stringify(join(app, 'tests/parity/reporter.mjs'))} : name, options]),
      };
    `);
    writeFileSync(join(dir, 'sample.spec.mjs'), `
      import { test, expect } from ${JSON.stringify(join(app, 'node_modules/@playwright/test/index.mjs'))};
      import { writeFileSync } from 'node:fs';
      test.describe('overview | tenant_owner | es', () => {
        for (const name of ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance']) {
          test(name, async ({}, info) => {
            await info.attach(name, { body: Buffer.from('synthetic attachment ' + name), contentType: 'text/plain' });
            const trace = info.outputPath('trace.zip');
            writeFileSync(trace, 'synthetic trace ' + name);
            await info.attach(name + '-trace', { path: trace, contentType: 'application/zip' });
            expect(process.env.PARITY_MERGE_TEST_FAILURE === name).toBe(false);
          });
        }
      });
    `);
    const execute = async (args, report, env) => {
      const result = await runNode([cli, ...args], app, { PARITY_REPORT_DIR: report, ...env });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const whole = join(dir, 'whole');
    await execute(['test', '--config', config, '--workers=3'], whole);
    const expected = JSON.parse(readFileSync(join(whole, reportPath), 'utf8'));
    assert.equal(expected.result, 'PARITY_PASS');
    const blobs = join(dir, 'blobs'); mkdirSync(blobs);
    for (const shard of [1, 2]) {
      const output = join(dir, `shard-${shard}`);
      await execute(['test', '--config', config, '--workers=3', `--shard=${shard}/2`], output);
      assert.equal(JSON.parse(readFileSync(join(output, reportPath), 'utf8')).result, undefined);
      const files = readdirSync(join(output, 'blob'));
      assert.equal(files.length, 1);
      for (const file of files) copyFileSync(join(output, 'blob', file), join(blobs, file));
    }
    const merged = join(dir, 'merged');
    await execute(['merge-reports', '--config', 'tests/parity/merge.config.mjs', blobs], merged);
    assert.deepEqual(JSON.parse(readFileSync(join(merged, reportPath), 'utf8')), expected);
    const results = JSON.parse(readFileSync(join(merged, 'results.json'), 'utf8'));
    assert.equal(results.stats.expected, 8);
    assert.equal(results.stats.skipped + results.stats.unexpected + results.stats.flaky, 0);
    assert.ok(readFileSync(join(merged, 'html/index.html'), 'utf8').includes('<html'));
    const attachments = results.suites.flatMap((suite) => suite.suites.flatMap((group) => group.specs.flatMap((spec) => spec.tests.flatMap((test) => test.results.flatMap((result) => result.attachments)))));
    assert.equal(attachments.length, 16);
    for (const attachment of attachments) {
      if (attachment.body) assert.equal(Buffer.from(attachment.body, 'base64').toString(), `synthetic attachment ${attachment.name}`);
      else assert.equal(readFileSync(attachment.path, 'utf8'), `synthetic trace ${attachment.name.replace(/-trace$/, '')}`);
    }
    const failed = join(dir, 'failed');
    const failure = await runNode([cli, 'test', '--config', config, '--workers=3', '--shard=2/2'], app, {
      PARITY_REPORT_DIR: failed, PARITY_MERGE_TEST_FAILURE: 'kit-conformance',
    });
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    for (const file of readdirSync(join(failed, 'blob'))) copyFileSync(join(failed, 'blob', file), join(blobs, file));
    await execute(['merge-reports', '--config', 'tests/parity/merge.config.mjs', blobs], merged);
    assert.equal(JSON.parse(readFileSync(join(merged, 'results.json'), 'utf8')).stats.unexpected, 1);
    assert.equal(JSON.parse(readFileSync(join(merged, reportPath), 'utf8')).result, undefined);
    assert.ok(readFileSync(join(merged, 'html/index.html'), 'utf8').includes('<html'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
