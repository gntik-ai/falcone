import test from 'node:test';
import assert from 'node:assert/strict';
import { main as workspaceConsumption } from '../../../packages/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs';
import { seedWorkspaceWithSubQuotas } from './fixtures/seed-workspace-with-sub-quotas.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };
const tenantOwner = { callerContext: { actor: { id: 'owner-1', type: 'tenant_owner', tenantId: 'pro-corp' } } };

test('workspace consumption returns sub-quota source and current usage', async () => {
  const db = seedWorkspaceWithSubQuotas();
  const result = await workspaceConsumption({ ...admin, tenantId: 'pro-corp', workspaceId: 'ws-prod' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.workspaceSource, 'workspace_sub_quota');
  assert.equal(entry.workspaceLimit, 6);
  assert.equal(entry.currentUsage, 4);
});

test('tenant owner self workspace consumption route defaults tenantId from caller context', async () => {
  const db = seedWorkspaceWithSubQuotas();
  const result = await workspaceConsumption({ ...tenantOwner, workspaceId: 'ws-prod' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.tenantId, 'pro-corp');
  assert.equal(result.body.workspaceId, 'ws-prod');
  assert.equal(entry.workspaceSource, 'workspace_sub_quota');
  assert.equal(entry.workspaceLimit, 6);
});

test('tenant owner cannot use explicit workspace consumption route for another tenant', async () => {
  const db = seedWorkspaceWithSubQuotas();

  await assert.rejects(
    workspaceConsumption({
      callerContext: { actor: { id: 'owner-2', type: 'tenant_owner', tenantId: 'other-corp' } },
      tenantId: 'pro-corp',
      workspaceId: 'ws-prod'
    }, { db }),
    { code: 'FORBIDDEN', statusCode: 403 }
  );
});

test('workspace admin consumption is scoped to the trusted workspace id', async () => {
  const db = seedWorkspaceWithSubQuotas();
  const result = await workspaceConsumption({
    callerContext: { actor: { id: 'workspace-admin-1', type: 'workspace_admin', tenantId: 'pro-corp', workspaceId: 'ws-prod' } },
    workspaceId: 'ws-prod'
  }, { db });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.tenantId, 'pro-corp');
  assert.equal(result.body.workspaceId, 'ws-prod');

  await assert.rejects(
    workspaceConsumption({
      callerContext: { actor: { id: 'workspace-admin-1', type: 'workspace_admin', tenantId: 'pro-corp', workspaceId: 'ws-dev' } },
      workspaceId: 'ws-prod'
    }, { db }),
    { code: 'FORBIDDEN', statusCode: 403 }
  );
});

test('superadmin self workspace consumption route still requires an explicit tenantId', async () => {
  const db = seedWorkspaceWithSubQuotas();

  await assert.rejects(
    workspaceConsumption({ ...admin, workspaceId: 'ws-prod' }, { db }),
    { code: 'TENANT_NOT_FOUND', statusCode: 404 }
  );
});
