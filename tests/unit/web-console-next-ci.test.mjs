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
    'node scripts/validate-gntik-ui-pin.mjs',
    'docker build -f apps/web-console/Dockerfile .',
  ]) assert.ok(commands.includes(command), `Missing CI check: ${command}`);
  assert.ok(commands.some((command) => command.includes('VITE_BASE_PATH=') && command.includes('/next/') && command.includes('web-console-next build')));

  const release = YAML.parse(readFileSync('.github/workflows/release-images.yml', 'utf8'));
  const releaseSteps = Object.values(release.jobs).flatMap((job) => job.steps ?? []);
  for (const step of releaseSteps.filter((step) => step.if === "matrix.build_spa == 'true'" && step.run)) {
    assert.ok(commands.includes(step.run), `Missing release-equivalent command: ${step.run}`);
  }
  const serialized = JSON.stringify(job);
  assert.doesNotMatch(serialized, /secrets\.|docker push|push:|login-action|registry-url/);
  assert.equal(ci.on.pull_request?.paths, undefined);
});
