import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setSubQuota } from '../../../services/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs';
import { createFakeDb, createFakeProducer, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('combined allocations exceeding tenant limit reject second request', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const producer = createFakeProducer();
  await setSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-1', dimensionKey: 'max_workspaces', allocatedValue: 6 }, { db, producer });
  await assert.rejects(() => setSubQuota({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-2', dimensionKey: 'max_workspaces', allocatedValue: 5 }, { db, producer }), (error) => error.statusCode === 422);
  assert.equal(db._workspaceSubQuotas.filter((x) => x.tenantId === 'tenant-a' && x.dimensionKey === 'max_workspaces').length, 1);
});
