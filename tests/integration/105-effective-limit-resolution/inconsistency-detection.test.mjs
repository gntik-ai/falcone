import test from 'node:test';
import assert from 'node:assert/strict';
import { main as workspaceLimits } from '../../../services/provisioning-orchestrator/src/actions/workspace-effective-limits-get.mjs';
import { isInconsistentSubQuota } from '../../../services/provisioning-orchestrator/src/models/effective-entitlements.mjs';
import { createFakeDb, createFakeProducer, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('plan downgrade leaves sub-quota unchanged and flags inconsistency once', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db); seedAssignments(db);
  db._workspaceSubQuotas.push({ id: 'sq-inconsistent', tenantId: 'tenant-a', workspaceId: 'ws-prod', dimensionKey: 'max_workspaces', allocatedValue: 7, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  db._quotaOverrides.push({ id: 'ov-low', tenantId: 'tenant-a', dimensionKey: 'max_workspaces', overrideValue: 3, quotaType: 'hard', graceMargin: 0, status: 'active' });
  const first = await workspaceLimits({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-prod' }, { db, producer });
  assert.equal(first.body.dimensions.find((x) => x.dimensionKey === 'max_workspaces').isInconsistent, true);
  assert.equal(db._workspaceSubQuotas.find((x) => x.id === 'sq-inconsistent').allocatedValue, 7);
  assert.equal(producer.sent.length, 1);
  await workspaceLimits({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-prod' }, { db, producer });
  assert.equal(producer.sent.length, 1);
});

test('inconsistency helper handles unlimited tenant correctly', async () => {
  assert.equal(isInconsistentSubQuota(7, -1), false);
  assert.equal(isInconsistentSubQuota(-1, 3), false);
});
