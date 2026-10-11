import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('PR CI runs HTTP idempotency against real Postgres and requires the issue reproductions', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const job = workflow.jobs['http-idempotency'];
  assert.ok(job, 'the real Postgres suite must run in PR CI');
  assert.equal(job.if, undefined, 'coverage cannot depend on an opt-in repository variable');
  assert.match(job.services.postgres.image, /postgres:.*@sha256:[a-f0-9]{64}$/);
  assert.ok(job.env.HTTP_IDEMPOTENCY_TEST_DATABASE_URL);
  assert.equal(job.env.HTTP_IDEMPOTENCY_TEST_REQUIRED, '1');
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /pnpm install --frozen-lockfile/);
  assert.match(commands, /node --test tests\/integration\/http-idempotency-postgres\.test\.mjs/);
  assert.match(commands, /node --test tests\/unit\/http-idempotency-server\.test\.mjs/);
});
