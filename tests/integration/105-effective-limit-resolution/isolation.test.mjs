import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setSubQuota } from '../../../services/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs';
import { main as listSubQuota } from '../../../services/provisioning-orchestrator/src/actions/workspace-sub-quota-list.mjs';
import { createFakeDb, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';
import { seedSubQuotas } from './fixtures/seed-sub-quotas.mjs';

test('workspace admin cannot modify another tenant records and listing is scoped', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedSubQuotas(db);
  const workspaceAdmin = { callerContext: { actor: { id: 'wa-1', type: 'workspace_admin', tenantId: 'tenant-a', workspaceId: 'ws-1' } } };
  await assert.rejects(() => setSubQuota({ ...workspaceAdmin, tenantId: 'tenant-b', workspaceId: 'ws-other', dimensionKey: 'max_workspaces', allocatedValue: 1 }, { db }), (error) => error.statusCode === 403);
  const list = await listSubQuota({ ...workspaceAdmin, tenantId: 'tenant-a' }, { db });
  assert.equal(list.body.items.every((x) => x.workspaceId === 'ws-1'), true);
});

test('tenant owner cannot access other tenant sub-quotas', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedSubQuotas(db);
  const tenantOwner = { callerContext: { actor: { id: 'owner-a', type: 'tenant_owner', tenantId: 'tenant-a' } } };
  await assert.rejects(() => setSubQuota({ ...tenantOwner, tenantId: 'tenant-b', workspaceId: 'ws-other', dimensionKey: 'max_workspaces', allocatedValue: 1 }, { db }), (error) => error.statusCode === 403);
});
