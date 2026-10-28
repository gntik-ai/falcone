import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  assert.deepEqual(shards?.strategy, { 'fail-fast': false, matrix: { shard: [1, 2, 3, 4] } });
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
    assert.equal(job['runs-on'], 'ubuntu-latest');
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
  assert.ok(commands(shards).includes('pnpm --filter @in-falcone/web-console-next exec playwright test --config tests/parity/playwright.config.mjs --shard=${{ matrix.shard }}/4'));
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
  assert.equal(aggregate.steps.length, 1, 'aggregate only checks results');
  assert.equal(aggregate.steps[0].uses, undefined);
  assert.deepEqual(aggregate.steps[0].env, {
    STRUCTURE_RESULT: '${{ needs.ui-parity-structure.result }}',
    SHARDS_RESULT: '${{ needs.ui-parity-shards.result }}',
    NEGATIVES_RESULT: '${{ needs.ui-parity-negatives.result }}',
  });
}

test('ui-parity is an unconditional isolated job with pinned actions and downloadable reports', () => {
  assertParityWorkflow(YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')));
  const config = readFileSync('apps/web-console-next/tests/parity/playwright.config.mjs', 'utf8');
  assert.match(config, /workers: 1/);
  assert.doesNotMatch(config, /fullyParallel/);
});

test('ui-parity structure checks reject coverage loss and a bypassed aggregate', () => {
  const mutations = [
    (jobs) => { jobs['ui-parity-shards'].strategy.matrix.shard.pop(); },
    (jobs) => { jobs['ui-parity-shards'].steps.find((s) => s.run?.includes('--shard=')).run = 'pnpm --filter @in-falcone/web-console-next exec playwright test --config tests/parity/playwright.config.mjs'; },
    (jobs) => { delete jobs['ui-parity-shards'].steps.at(-1).if; },
    (jobs) => { jobs['ui-parity-shards'].steps.at(-1).with.name = 'ui-parity-negatives'; },
    (jobs) => { jobs['ui-parity'].needs.pop(); },
    (jobs) => { delete jobs['ui-parity'].if; },
    (jobs) => { jobs['ui-parity-negatives'].if = 'false'; },
  ];
  for (const mutate of mutations) {
    const ci = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    mutate(ci.jobs);
    assert.throws(() => assertParityWorkflow(ci), { code: 'ERR_ASSERTION' });
  }
});

test('ui-parity aggregate fails on failure, cancellation, skipping or missing results', () => {
  const job = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs['ui-parity'];
  const step = job.steps[0];
  const success = { STRUCTURE_RESULT: 'success', SHARDS_RESULT: 'success', NEGATIVES_RESULT: 'success' };
  const run = (results) => spawnSync('bash', ['-e', '-c', step.run], { env: { ...process.env, ...results }, encoding: 'utf8' });
  assert.equal(run(success).status, 0);
  for (const key of Object.keys(success)) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) {
      assert.equal(run({ ...success, [key]: result }).status, 1, `${key}=${result}`);
    }
  }
});
