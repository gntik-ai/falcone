import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeRoute } from '../../apps/control-plane/route-invoke.mjs';
import { getSagaStatus } from '../../apps/control-plane-executor/src/saga/saga-status.mjs';
const identity = { sub: 'actor-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', workspaceIds: ['workspace-a'], roles: [] };
const context = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actor: { id: 'actor-a' } };
const db = { async query(sql, values) {
  if (sql.includes('saga_instances')) return { rows: [{ saga_id: values[0], workflow_id: 'WF-CON-003', tenant_id: 'tenant-a', workspace_id: 'workspace-a', status: 'completed' }] };
  return { rows: [] };
} };

test('workflow-status returns a saga through supported invoke with trusted scope', async () => {
  const result = await invokeRoute({ invoke: 'workflow-status' }, getSagaStatus,
    { workspaceId: 'workspace-a', jobRef: 'saga-a', callerContext: { tenantId: 'tenant-b' } }, context, identity, db);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.sagaId, 'saga-a');
  assert.equal(result.body.status, 'completed');
});

for (const params of [{ tenantId: 'tenant-b', jobRef: 'saga-a' }, { workspaceId: 'workspace-b', jobRef: 'saga-a' }]) {
  test(`workflow status denies foreign URL scope ${JSON.stringify(params)}`, async () => {
    const result = await invokeRoute({ invoke: 'workflow-status' }, getSagaStatus, params, context, identity,
      { query() { throw new Error('foreign URL must be denied before querying'); } });
    assert.equal(result.statusCode, 403);
  });
}
for (const row of [{ tenant_id: 'tenant-b', workspace_id: 'workspace-a' }, { tenant_id: 'tenant-a', workspace_id: 'workspace-b' }]) {
  test(`workflow status denies foreign saga owner ${JSON.stringify(row)}`, async () => {
    const result = await invokeRoute({ invoke: 'workflow-status' }, getSagaStatus,
      { workspaceId: 'workspace-a', jobRef: 'saga-b' }, context, identity,
      { async query() { return { rows: [row] }; } });
    assert.equal(result.statusCode, 403);
  });
}
test('tenant workflow route returns own saga and maps absent sagas to 404', async () => {
  const route = { invoke: 'workflow-status' };
  assert.equal((await invokeRoute(route, getSagaStatus, { tenantId: 'tenant-a', jobRef: 'saga-a' }, context, identity, db)).statusCode, 200);
  assert.equal((await invokeRoute(route, getSagaStatus, { tenantId: 'tenant-a', jobRef: 'absent' }, context, identity, { async query() { return { rows: [] }; } })).statusCode, 404);
  assert.equal((await invokeRoute(route, getSagaStatus, {}, null, null, db)).statusCode, 401);
});
