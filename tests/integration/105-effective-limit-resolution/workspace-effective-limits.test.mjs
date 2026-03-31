import test from 'node:test';
import assert from 'node:assert/strict';
import { main as workspaceLimits } from '../../../services/provisioning-orchestrator/src/actions/workspace-effective-limits-get.mjs';
import { createFakeDb, createFakeProducer, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';
import { seedSubQuotas } from './fixtures/seed-sub-quotas.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('workspace with sub-quota resolves workspace_sub_quota source', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedSubQuotas(db);
  const result = await workspaceLimits({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-prod' }, { db, producer: createFakeProducer() });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.workspaceSource, 'workspace_sub_quota');
  assert.equal(entry.workspaceLimit, 6);
  assert.equal(entry.isInconsistent, false);
});

test('workspace without sub-quota resolves tenant_shared_pool source', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedSubQuotas(db);
  const result = await workspaceLimits({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-dev' }, { db, producer: createFakeProducer() });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.workspaceSource, 'tenant_shared_pool');
  assert.equal(entry.workspaceLimit, null);
});

test('workspace zero sub-quota is not inconsistent when tenant limit permits it', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  db._workspaceSubQuotas.push({ id: 'sq-zero', tenantId: 'tenant-a', workspaceId: 'ws-zero', dimensionKey: 'max_pg_databases', allocatedValue: 0, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const result = await workspaceLimits({ ...admin, tenantId: 'tenant-a', workspaceId: 'ws-zero' }, { db, producer: createFakeProducer() });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.workspaceLimit, 0);
  assert.equal(entry.isInconsistent, false);
});
