import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setSubQuota } from '../../../services/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs';
import { main as removeSubQuota } from '../../../services/provisioning-orchestrator/src/actions/workspace-sub-quota-remove.mjs';
import { createFakeDb, createFakeProducer, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';
import { seedSubQuotas } from './fixtures/seed-sub-quotas.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('create, idempotent reset, modify and remove workspace sub-quota', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db); seedAssignments(db); seedSubQuotas(db);
  const created = await setSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-dev', dimensionKey: 'max_pg_databases', allocatedValue: 4 }, { db, producer });
  assert.equal(created.statusCode, 201);
  assert.equal(producer.sent.length, 1);
  const same = await setSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-dev', dimensionKey: 'max_pg_databases', allocatedValue: 4 }, { db, producer });
  assert.equal(same.statusCode, 200);
  assert.equal(producer.sent.length, 1);
  const modified = await setSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-dev', dimensionKey: 'max_pg_databases', allocatedValue: 2 }, { db, producer });
  assert.equal(modified.body.allocatedValue, 2);
  assert.equal(producer.sent.length, 2);
  const removed = await removeSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-dev', dimensionKey: 'max_pg_databases' }, { db, producer });
  assert.equal(removed.body.removed, true);
  assert.equal(producer.sent.length, 3);
  assert.equal(db._planAuditEvents.some((x) => x.action_type === 'quota.sub_quota.removed'), true);
});

test('allocate -1 is rejected', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  await assert.rejects(() => setSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-dev', dimensionKey: 'max_pg_databases', allocatedValue: -1 }, { db }), (error) => error.statusCode === 400 && error.code === 'INVALID_SUB_QUOTA_VALUE');
});

test('finite sub-quota under unlimited tenant dimension is accepted', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await setSubQuota({ ...admin, tenantId: 'unlimited-corp', workspaceId: 'ws-dev', dimensionKey: 'max_functions', allocatedValue: 999 }, { db, producer: createFakeProducer() });
  assert.equal(result.body.allocatedValue, 999);
});

test('remove non-existent sub-quota returns 404', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  await assert.rejects(() => removeSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'missing', dimensionKey: 'max_pg_databases' }, { db, producer: createFakeProducer() }), (error) => error.statusCode === 404);
});
