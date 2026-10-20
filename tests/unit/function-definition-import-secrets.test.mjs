import test from 'node:test';
import assert from 'node:assert/strict';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { NS } from '../../apps/control-plane/function-executor.mjs';
import { cluster } from '../helpers/function-kubernetes-fixture.mjs';
import { invocationFixture, installInvocationFixture } from '../helpers/function-invocation-fixture.mjs';

const ws = { id: 'ws-import', tenant_id: 'tenant-import', slug: 'app' };
const refs = [{ name: 'api-key', env: 'CUSTOM_API_KEY' }];

// PostgreSQL boundary: model action-name conflicts from the bound INSERT values. Run the real
// import, registry, consumer and revocation code; no handler/store collaborators are replaced.
function database() {
  const actions = new Map();
  return { async query(sql, params = []) {
    if (sql.includes('FROM workspaces')) return { rows: params[0] === ws.id ? [ws] : [] };
    if (sql.startsWith('SELECT * FROM fn_actions')) {
      let rows = [...actions.values()];
      for (const [, column, parameter] of sql.matchAll(/(workspace_id|action_name|tenant_id|resource_id)=\$(\d+)/g)) {
        rows = rows.filter((row) => row[column] === params[Number(parameter) - 1]);
      }
      return { rows: structuredClone(rows) };
    }
    if (sql.startsWith('INSERT INTO fn_actions')) {
      const columns = sql.match(/fn_actions \(([^)]+)\)/)[1].split(',').map((column) => column.trim());
      const incoming = Object.fromEntries(columns.map((column, index) => [column,
        ['secret_refs', 'parameters'].includes(column) && params[index] != null ? JSON.parse(params[index]) : params[index]]));
      const existing = [...actions.values()].find((row) => row.workspace_id === incoming.workspace_id && row.action_name === incoming.action_name);
      const row = { ...existing, ...incoming, resource_id: existing?.resource_id ?? incoming.resource_id,
        version: (existing?.version ?? 0) + 1 };
      actions.set(row.resource_id, row);
      return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith('DELETE FROM fn_actions')) {
      const row = actions.get(params[0]);
      if (row?.tenant_id !== params[1]) return { rows: [] };
      actions.delete(params[0]);
      return { rows: [row] };
    }
    // Version history/activations are outside this fixture's lifecycle assertions.
    if (sql.includes('fn_action_versions') || sql.includes('fn_activations')) return { rows: [] };
    assert.fail(`Unexpected database statement: ${sql}`);
  } };
}

test('definition and package import preserve deployed secret consumers through rotation, revocation and Function deletion', async (t) => {
  installInvocationFixture(t, invocationFixture());
  for (const handler of ['fnDefinitionImport', 'fnPackageDefinitionImport']) {
    const api = cluster({ knative: true });
    const ctx = {
      pool: database(), identity: { actorType: 'tenant_owner', tenantId: ws.tenant_id,
        workspaceId: ws.id, workspaceIds: [ws.id], roles: ['workspace_owner'], sub: 'owner' },
      params: { workspaceId: ws.id, secretName: 'api-key' },
      knativeRuntime: { functionsEnabled: true, status: () => ({ state: 'ready' }), canServeWorkloads: () => true },
      quotaOptions: { resolveEffectiveLimits: async () => ({ max_functions: null }) },
      functionKubernetesRequest: api.request,
      body: { workspaceId: ws.id, actionName: 'billing/hello', source: { inlineCode: 'return 1' }, execution: { secrets: refs } },
    };
    let value = 'import-old-marker';
    ctx.vaultStore = {
      validName: () => true, exists: async () => value !== null,
      getMeta: async () => ({ name: 'api-key' }), list: async () => [{ name: 'api-key' }],
      resolveEnv: async (_t, _w, declared) => declared.length ? [{ name: 'CUSTOM_API_KEY', value }] : [],
      replace: async (_t, _w, name, next) => { value = next; return { name }; },
      delete: async () => { value = null; },
    };
    const deployed = await FN_HANDLERS.fnDeploy(ctx);
    assert.equal(deployed.statusCode, 202);
    const resourceId = deployed.body.resourceId;
    const secretPath = [...api.objects.keys()].find((path) => path.includes('/secrets/'));
    assert.ok(secretPath);

    ctx.body = { definitions: [{ packageName: 'billing', actionName: 'hello', sourceCode: 'return 2' }] };
    const imported = await FN_HANDLERS[handler](ctx);
    assert.equal(imported.statusCode, 200);
    assert.deepEqual(imported.body.imported, [{ resourceId, actionName: 'billing/hello' }]);
    assert.equal((await FN_HANDLERS.secretGet(ctx)).body.resolvedRefCount, 1);
    assert.equal((await FN_HANDLERS.secretList(ctx)).body.items[0].resolvedRefCount, 1);

    ctx.body = { value: 'import-new-marker' };
    const replaced = await FN_HANDLERS.secretReplace(ctx);
    assert.equal(replaced.statusCode, 200);
    assert.deepEqual(replaced.body.affectedFunctions, [resourceId]);
    assert.equal(replaced.body.resolvedRefCount, 1);
    assert.deepEqual(api.objects.get(secretPath).data, { CUSTOM_API_KEY: Buffer.from('import-new-marker').toString('base64') });
    const deleted = await FN_HANDLERS.secretDelete(ctx);
    assert.equal(deleted.statusCode, 204);
    assert.deepEqual(JSON.parse(deleted.headers['x-falcone-affected-functions']), [resourceId]);
    assert.equal(deleted.headers['x-falcone-resolved-ref-count'], '1');
    assert.equal(api.objects.has(secretPath), false);
    assert.equal(JSON.stringify([...api.objects.values()]).includes('import-new-marker'), false);

    ctx.params = { actionId: resourceId };
    const removed = await FN_HANDLERS.fnDelete(ctx);
    assert.equal(removed.statusCode, 202);
    assert.equal([...api.objects.keys()].some((path) => path.includes(`/namespaces/${NS}/`)), false);
  }
});

test('an import started before deployment cannot overwrite the newly deployed secret refs', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const pool = database();
  const query = pool.query.bind(pool);
  let entered;
  const importWriting = new Promise((resolve) => { entered = resolve; });
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  pool.query = async (sql, params) => {
    if (sql.startsWith('INSERT INTO fn_actions') && params[6] === 'imported code') {
      entered();
      await paused;
    }
    return query(sql, params);
  };
  const ctx = {
    pool, identity: { actorType: 'tenant_owner', tenantId: ws.tenant_id,
      workspaceId: ws.id, workspaceIds: [ws.id], roles: ['workspace_owner'], sub: 'owner' },
    params: { workspaceId: ws.id, secretName: 'api-key' },
    knativeRuntime: { functionsEnabled: true, status: () => ({ state: 'ready' }), canServeWorkloads: () => true },
    quotaOptions: { resolveEffectiveLimits: async () => ({ max_functions: null }) },
    functionKubernetesRequest: api.request,
    vaultStore: { resolveEnv: async () => [{ name: 'CUSTOM_API_KEY', value: 'race-marker' }],
      getMeta: async () => ({ name: 'api-key' }) },
  };
  const imported = FN_HANDLERS.fnDefinitionImport({ ...ctx,
    body: { definitions: [{ actionName: 'hello', sourceCode: 'imported code' }] } });
  await importWriting;
  const deployed = FN_HANDLERS.fnDeploy({ ...ctx,
    body: { workspaceId: ws.id, actionName: 'hello', source: { inlineCode: 'return 1' }, execution: { secrets: refs } } });
  // Drain the competing request while the import's database write is paused.
  await new Promise(setImmediate);
  resume();
  assert.equal((await imported).statusCode, 200);
  assert.equal((await deployed).statusCode, 202);
  assert.equal((await FN_HANDLERS.secretGet(ctx)).body.resolvedRefCount, 1);
});
