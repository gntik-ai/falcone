// bbx-webhook-schema-bootstrap
//
// Black-box coverage for change add-webhook-engine-kind-runtime (GitHub #643).
//
// The kind control-plane provisions the webhook relations at boot via
// applyWebhookSchema(pool). These tests drive it with a recording pool + a real
// file read from the checkout, asserting: it applies migrations 001 (tables) and
// 002 (tenant columns) only, the DDL is idempotent (IF NOT EXISTS), and it does
// NOT enable FORCE RLS / create policies on kind (migration 003 is deferred to
// the RLS-rollout feature — applying it without a SET LOCAL app.tenant_id wrapper
// would make every webhook query match zero rows).
//
// Scenarios:
//   bbx-643-schema-01: applies migrations 001 + 002 (and only those) with idempotent DDL
//   bbx-643-schema-02: does NOT enable row-level security / create policies (003 deferred)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWebhookSchema, WEBHOOK_MIGRATIONS } from '../../apps/control-plane/webhook-schema.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function recordingPool() {
  const calls = [];
  return { calls, async query(text) { calls.push(String(text)); return { rows: [] }; } };
}

test('bbx-643-schema-01: applies migrations 001 + 002 only, with idempotent DDL', async () => {
  const pool = recordingPool();
  const applied = await applyWebhookSchema(pool, { repoRoot: REPO_ROOT, log: { log() {} } });
  assert.deepEqual(applied, WEBHOOK_MIGRATIONS);
  assert.equal(applied.length, 2, 'exactly migrations 001 + 002');
  const all = pool.calls.join('\n').toLowerCase();
  assert.ok(/create table if not exists webhook_subscriptions/.test(all), 'creates webhook_subscriptions idempotently');
  assert.ok(/create table if not exists webhook_signing_secrets/.test(all), 'creates webhook_signing_secrets idempotently');
  assert.ok(/create table if not exists webhook_deliveries/.test(all), 'creates webhook_deliveries idempotently');
  assert.ok(/add column if not exists tenant_id/.test(all), 'migration 002 adds tenant columns idempotently');
});

test('bbx-643-schema-02: does NOT enable RLS / create policies on kind (003 deferred)', async () => {
  const pool = recordingPool();
  await applyWebhookSchema(pool, { repoRoot: REPO_ROOT, log: { log() {} } });
  const all = pool.calls.join('\n').toLowerCase();
  assert.ok(!/enable row level security/.test(all), 'no ENABLE ROW LEVEL SECURITY (003 deferred)');
  assert.ok(!/force row level security/.test(all), 'no FORCE ROW LEVEL SECURITY (003 deferred)');
  assert.ok(!/create policy/.test(all), 'no CREATE POLICY (003 deferred)');
});
