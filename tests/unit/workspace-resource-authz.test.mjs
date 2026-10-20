import test from 'node:test';
import assert from 'node:assert/strict';
import { REALTIME_HANDLERS } from '../../apps/control-plane/realtime-handlers.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const ws = { id: 'ws2', tenant_id: 'tenant-t', environment: 'production' };
const caller = (role, workspaceIds = []) => ({ actorType: 'tenant_member', tenantId: 'tenant-t', roles: [role], workspaceIds });
function context(identity = caller('tenant_viewer')) {
  return { identity, params: { workspaceId: 'ws2' }, body: { workspaceId: 'ws2' }, query: {},
    req: { headers: { 'x-workspace-id': 'ws2' } },
    store: { getWorkspace: async () => ws },
    pool: { query: async () => ({ rows: [] }) } };
}

test('unbound tenant viewer cannot discover production realtime channels', async () => {
  const ctx = context();
  let connections = 0;
  ctx.pool.query = async () => { connections++; return { rows: [] }; };
  const result = await REALTIME_HANDLERS.getWorkspaceRealtime(ctx);
  assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } });
  assert.equal(connections, 0);
});

test('development caller cannot list production functions or trigger runtime reads', async () => {
  const ctx = context(caller('tenant_developer', ['ws1']));
  ctx.store.listFnActions = async () => { throw new Error('function registry read after denial'); };
  for (const name of ['fnInventory', 'fnListActions']) {
    const result = await FN_HANDLERS[name](ctx);
    assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } });
  }
});

test('production definition export cannot substitute a development binding', async () => {
  const ctx = context(caller('tenant_developer', ['ws1']));
  ctx.params.resourceId = 'fn_prod';
  const row = { resource_id: 'fn_prod', tenant_id: ws.tenant_id, workspace_id: ws.id };
  ctx.store.getFnAction = async () => row;
  ctx.pool.query = async (sql) => ({ rows: sql.includes('fn_actions') ? [row] : [ws] });
  const result = await FN_HANDLERS.fnDefinitionExport(ctx);
  assert.deepEqual(result, { statusCode: 404, body: { code: 'ACTION_NOT_FOUND', message: 'action fn_prod not found' } });
});

test('an unbound function deployment is hidden before locks or Knative', async () => {
  const ctx = context(caller('tenant_developer'));
  ctx.body.actionName = 'production';
  const result = await FN_HANDLERS.fnDeploy(ctx);
  assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } });
});

test('storage usage denies a development binding before bucket enumeration or S3', async () => {
  const ctx = context(caller('tenant_developer', ['ws1']));
  ctx.pool.query = async (sql) => {
    if (sql.includes('FROM workspaces')) return { rows: [ws] };
    throw new Error('bucket enumeration after denial');
  };
  const result = await STORAGE_HANDLERS.storageWorkspaceUsage(ctx);
  assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } });
});

test('bound readers and verified tenant administrators retain realtime and function list shapes', async () => {
  for (const [role, bindings] of [['tenant_viewer', ['ws2']], ['workspace_viewer', ['ws2']], ['tenant_owner', []], ['tenant_admin', []]]) {
    const ctx = context(caller(role, bindings));
    ctx.store.listFnActions = async () => [];
    ctx.knativeRuntime = { status: () => ({ state: 'ready' }), canServeWorkloads: () => true };
    const realtime = await REALTIME_HANDLERS.getWorkspaceRealtime(ctx);
    assert.equal(realtime.statusCode, 200, role);
    assert.equal(realtime.body.workspaceId, 'ws2');
    assert.deepEqual(realtime.body.features, { realtime: false });
    assert.deepEqual(realtime.body.dataSources, []);
    assert.deepEqual(await FN_HANDLERS.fnListActions(ctx), { statusCode: 200, body: { items: [], page: { total: 0 } } });
  }
});

test('a model-authorized production service account can invoke its Function', async () => {
  const ctx = context(caller('workspace_service_account', ['ws2']));
  ctx.params.actionId = 'fn_prod';
  ctx.store.getFnAction = async () => ({ resource_id: 'fn_prod', workspace_id: 'ws2', tenant_id: 'tenant-t', ksvc_name: 'fn-prod' });
  let probes = 0, invocations = 0, activations = 0;
  ctx.knativeRuntime = { functionsEnabled: true, status: () => ({ state: 'ready' }), canServeWorkloads: () => true };
  ctx.waitKsvcReady = async () => { probes++; return true; };
  ctx.invokeKnative = async () => { invocations++; return { status: 'success', statusCode: 200, result: { value: 7 }, logs: [], durationMs: 1 }; };
  ctx.store.insertFnActivation = async () => { activations++; };
  const result = await FN_HANDLERS.fnInvoke(ctx);
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.resourceId, 'fn_prod');
  assert.equal(result.body.status, 'completed');
  assert.deepEqual([probes, invocations, activations], [1, 1, 1]);
});

test('foreign and unmapped realtime workspaces are hidden even with matching bindings', async () => {
  for (const record of [null, { id: 'ws2', tenant_id: 'foreign' }, { id: null, tenant_id: 'tenant-t' }]) {
    const ctx = context(caller('tenant_owner', ['ws2']));
    ctx.store.getWorkspace = async () => record;
    ctx.pool.query = async () => { throw new Error('realtime data after denial'); };
    assert.equal((await REALTIME_HANDLERS.getWorkspaceRealtime(ctx)).statusCode, 404);
  }
});
