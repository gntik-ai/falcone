// bbx-webhook-db-adapter
//
// Black-box coverage for change add-webhook-engine-kind-runtime (GitHub #643).
//
// The kind control-plane wires the (code-complete) webhook-management action by
// injecting a Postgres-backed `db` adapter built from the runtime pool. The
// security-critical invariant of that adapter is that EVERY tenant-scoped query
// carries a `(tenant_id, workspace_id)` predicate / binds the tenant dimension —
// a `subscription_id` alone must never be sufficient to read or rotate across
// tenant boundaries. These tests drive the adapter against a recording `pool`
// stub (no live Postgres needed) and assert the SQL contract + param binding +
// return mapping. The full lifecycle against real SQL is proven on the kind
// cluster (tasks.md 8.3 / /e2e-issue).
//
// Scenarios:
//   bbx-643-db-01: getWorkspaceSubscriptionCount scopes by (tenant_id, workspace_id) and returns an int
//   bbx-643-db-02: listSubscriptions scopes by (tenant_id, workspace_id) and excludes soft-deleted
//   bbx-643-db-03: insertSecret binds the subscription tenant_id/workspace_id + cipher/iv
//   bbx-643-db-04: rotateSecret graces the active secret (tenant-scoped) AND inserts a new active secret
//   bbx-643-db-05: cancelPendingDeliveries only touches this subscription's pending deliveries
//   bbx-643-db-06: getSubscription fetches by id (action layer applies the tenant check)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebhookDb } from '../../deploy/kind/control-plane/webhook-db.mjs';

// A pool stub that records every query and returns a caller-supplied response.
function recordingPool(responder) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params: params ?? [] });
      return (responder ? responder(text, params, calls.length - 1) : null) ?? { rows: [], rowCount: 0 };
    },
  };
}
const has = (sql, ...needles) => needles.every((n) => new RegExp(n, 'i').test(sql));

test('bbx-643-db-01: getWorkspaceSubscriptionCount scopes by tenant + workspace and returns an int', async () => {
  const pool = recordingPool((sql) => has(sql, 'count') ? { rows: [{ count: 3 }] } : null);
  const db = buildWebhookDb(pool);
  const n = await db.getWorkspaceSubscriptionCount('tenant-a', 'ws-a');
  assert.equal(n, 3);
  const q = pool.calls[0];
  assert.ok(has(q.text, 'from\\s+webhook_subscriptions'), 'queries webhook_subscriptions');
  assert.ok(has(q.text, 'tenant_id') && has(q.text, 'workspace_id'), 'predicate carries tenant + workspace');
  assert.deepEqual(q.params, ['tenant-a', 'ws-a']);
});

test('bbx-643-db-02: listSubscriptions scopes by tenant + workspace and excludes soft-deleted', async () => {
  const pool = recordingPool(() => ({ rows: [{ id: 's1', tenant_id: 'tenant-a', workspace_id: 'ws-a' }] }));
  const db = buildWebhookDb(pool);
  const rows = await db.listSubscriptions({ tenantId: 'tenant-a', workspaceId: 'ws-a' }, {});
  assert.equal(rows.length, 1);
  const q = pool.calls[0];
  assert.ok(has(q.text, 'from\\s+webhook_subscriptions'));
  assert.ok(has(q.text, 'tenant_id') && has(q.text, 'workspace_id'), 'tenant + workspace predicate');
  assert.ok(has(q.text, 'deleted_at'), 'excludes soft-deleted rows');
  assert.ok(q.params.includes('tenant-a') && q.params.includes('ws-a'));
});

test('bbx-643-db-03: insertSecret binds the subscription tenant dimension + cipher/iv', async () => {
  const pool = recordingPool();
  const db = buildWebhookDb(pool);
  await db.insertSecret('sub-1', { cipher: 'CIPHER', iv: 'IV' }, 'tenant-a', 'ws-a');
  const q = pool.calls[0];
  assert.ok(has(q.text, 'insert\\s+into\\s+webhook_signing_secrets'));
  for (const v of ['sub-1', 'CIPHER', 'IV', 'tenant-a', 'ws-a']) {
    assert.ok(q.params.includes(v), `binds ${v}`);
  }
});

test('bbx-643-db-04: rotateSecret graces the active secret (tenant-scoped) then inserts a new active secret', async () => {
  const pool = recordingPool();
  const db = buildWebhookDb(pool);
  await db.rotateSecret('sub-1', { cipher: 'NEWC', iv: 'NEWIV' }, '2026-07-01T00:00:00.000Z', 'tenant-a', 'ws-a');
  assert.ok(pool.calls.length >= 2, 'rotate issues at least an update + an insert');
  const grace = pool.calls.find((c) => /update\s+webhook_signing_secrets/i.test(c.text));
  const insert = pool.calls.find((c) => /insert\s+into\s+webhook_signing_secrets/i.test(c.text));
  assert.ok(grace, 'graces the existing active secret');
  assert.ok(has(grace.text, 'grace') && has(grace.text, 'tenant_id') && has(grace.text, 'workspace_id'),
    'grace update is tenant-scoped');
  assert.ok(grace.params.includes('sub-1') && grace.params.includes('tenant-a') && grace.params.includes('ws-a'));
  assert.ok(insert, 'inserts the new active secret');
  for (const v of ['sub-1', 'NEWC', 'NEWIV', 'tenant-a', 'ws-a']) assert.ok(insert.params.includes(v), `insert binds ${v}`);
});

test('bbx-643-db-05: cancelPendingDeliveries only affects this subscription pending deliveries', async () => {
  const pool = recordingPool();
  const db = buildWebhookDb(pool);
  await db.cancelPendingDeliveries('sub-1');
  const q = pool.calls[0];
  assert.ok(has(q.text, 'update\\s+webhook_deliveries'));
  assert.ok(has(q.text, 'subscription_id') && has(q.text, "pending"), 'targets this subscription pending rows');
  assert.ok(q.params.includes('sub-1'));
});

test('bbx-643-db-06: getSubscription fetches by id (tenant check is applied by the action layer)', async () => {
  const pool = recordingPool(() => ({ rows: [{ id: 'sub-1', tenant_id: 'tenant-a', workspace_id: 'ws-a' }] }));
  const db = buildWebhookDb(pool);
  const row = await db.getSubscription('sub-1');
  assert.equal(row.id, 'sub-1');
  const q = pool.calls[0];
  assert.ok(has(q.text, 'from\\s+webhook_subscriptions') && has(q.text, 'id'));
  assert.deepEqual(q.params, ['sub-1']);
});
