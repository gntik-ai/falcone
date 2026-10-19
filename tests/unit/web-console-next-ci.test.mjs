import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
