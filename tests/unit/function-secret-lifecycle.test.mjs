import test from 'node:test';
import assert from 'node:assert/strict';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
const ws = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app' };
const owner = { actorType: 'tenant_owner', tenantId: 'tenant-a', roles: ['workspace_owner'], workspaceId: ws.id, sub: 'owner' };
const runtime = { functionsEnabled: true, status: () => ({ state: 'ready' }), canServeWorkloads: () => true };
const refs = [{ name: 'api-key', env: 'API_KEY' }];
const row = { resource_id: 'fn-a', tenant_id: ws.tenant_id, workspace_id: ws.id, ksvc_name: 'fn-app', secret_refs: refs, source_code: 'return 1' };
function context() {
  const rows = [];
  return {
    identity: owner, pool: {}, params: { workspaceId: ws.id, secretName: 'api-key' }, knativeRuntime: runtime,
    body: { workspaceId: ws.id, actionName: 'hello', source: { inlineCode: 'return 1' }, execution: { secrets: refs } },
    store: { getWorkspace: async () => ws, listFnActions: async () => rows,
      upsertFnAction: async (_p, a) => { rows.push({ ...row, resource_id: a.resourceId, ksvc_name: a.ksvcName, secret_refs: a.secretRefs }); return rows[0]; } },
    quotaOptions: { resolveEffectiveLimits: async () => ({ max_functions: null }) },
    vaultStore: { resolveEnv: async () => [{ name: 'API_KEY', value: 'synthetic-marker' }], getMeta: async () => ({ name: 'api-key' }) },
    deployKnativeService: async () => {},
  };
}
test('deploy persists only names and env mapping and metadata counts the real consumers', async () => {
  const ctx = context();
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 202);
  assert.deepEqual((await ctx.store.listFnActions())[0].secret_refs, refs);
  const meta = await FN_HANDLERS.secretGet(ctx);
  assert.equal(meta.body.resolvedRefCount, 1);
  assert.equal(JSON.stringify(meta).includes('synthetic-marker'), false);
});

import { cluster } from '../helpers/function-kubernetes-fixture.mjs';
import { deployKnativeService, NS } from '../../apps/control-plane/function-executor.mjs';
import { invocationFixture, installInvocationFixture } from '../helpers/function-invocation-fixture.mjs';
test('replace propagates to every consumer and delete revokes projections with a bodyless consumer report', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster({ knative: true, deferForegroundDeletion: true });
  const ctx = context();
  ctx.functionKubernetesRequest = api.request;
  ctx.store.listFnActions = async () => [row, { ...row, resource_id: 'fn-b', ksvc_name: 'fn-other' }];
  let value = 'old-marker';
  ctx.vaultStore = { validName: () => true, exists: async () => true,
    replace: async (_t, _w, name, next) => { value = next; return { name }; },
    delete: async () => { value = null; },
    resolveEnv: async (_t, _w, references) => references.length && value !== null ? [{ name: 'API_KEY', value }] : [],
  };
  for (const fn of await ctx.store.listFnActions()) {
    await deployKnativeService(fn.ksvc_name, fn.source_code, { tenantId: fn.tenant_id, workspaceId: fn.workspace_id, functionResourceId: fn.resource_id, secretEnv: [{ name: 'API_KEY', value }], request: api.request });
  }
  ctx.body = { value: 'new-marker' };
  const replaced = await FN_HANDLERS.secretReplace(ctx);
  assert.equal(replaced.statusCode, 200);
  assert.deepEqual(replaced.body.affectedFunctions, ['fn-a', 'fn-b']);
  for (const fn of await ctx.store.listFnActions()) {
    assert.deepEqual(api.objects.get(`/api/v1/namespaces/${NS}/secrets/${fn.ksvc_name}-secrets`).data, { API_KEY: Buffer.from('new-marker').toString('base64') });
  }
  const deleted = await FN_HANDLERS.secretDelete(ctx);
  assert.equal(deleted.statusCode, 204);
  assert.equal(deleted.body, null);
  assert.deepEqual(JSON.parse(deleted.headers['x-falcone-affected-functions']), ['fn-a', 'fn-b']);
  assert.equal(deleted.headers['x-falcone-resolved-ref-count'], '2');
  assert.equal([...api.objects.keys()].some((p) => p.includes('/secrets/')), false);
  assert.equal(JSON.stringify([...api.objects.values()]).includes('new-marker'), false);
  for (const fn of await ctx.store.listFnActions()) {
    const service = api.objects.get(`/apis/serving.knative.dev/v1/namespaces/${NS}/services/${fn.ksvc_name}`);
    assert.deepEqual(service.spec.template.spec.containers[0].env.find(({ name }) => name === 'API_KEY'), {
      name: 'API_KEY', valueFrom: { secretKeyRef: { name: `${fn.ksvc_name}-secrets`, key: 'API_KEY', optional: false } },
    });
  }
});

test('Function deletion retains a retryable obligation when Secret cleanup fails', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  await deployKnativeService(row.ksvc_name, row.source_code, { tenantId: ws.tenant_id, workspaceId: ws.id, functionResourceId: row.resource_id, secretEnv: [{ name: 'API_KEY', value: 'synthetic-marker' }], request: api.request });
  const ctx = context();
  ctx.params = { actionId: row.resource_id };
  ctx.store.getFnAction = async () => row;
  ctx.store.deleteFnAction = async () => { assert.fail('must retain registry until cleanup succeeds'); };
  let attemptedSecretDelete = false;
  ctx.functionKubernetesRequest = (method, path, body, options) => {
    if (method === 'DELETE' && path.includes('/secrets/')) {
      attemptedSecretDelete = true;
      throw Object.assign(new Error('Kubernetes unavailable'), { statusCode: 503 });
    }
    return api.request(method, path, body, options);
  };
  ctx.pool.query = async () => ({ rows: [{ obligation_id: 'cleanup-a', tenant_id: ws.tenant_id, workspace_id: ws.id, resource_id: row.resource_id, correlation_id: 'corr-a', status: 'pending' }] });
  const result = await FN_HANDLERS.fnDelete(ctx);
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.status, 'deletion_pending');
  assert.equal(result.body.resourceId, row.resource_id);
  assert.equal(attemptedSecretDelete, true);
});

test('Function DELETE remains retryable while foreground Service garbage collection is pending', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster({ knative: true, deferForegroundDeletion: true });
  await deployKnativeService(row.ksvc_name, row.source_code, { tenantId: ws.tenant_id, workspaceId: ws.id,
    functionResourceId: row.resource_id, secretEnv: [{ name: 'API_KEY', value: 'synthetic-marker' }], request: api.request });
  const ctx = context();
  ctx.params = { actionId: row.resource_id };
  let deleted = false;
  ctx.store.getFnAction = async () => deleted ? null : row;
  ctx.store.deleteFnAction = async () => { deleted = true; return row; };
  ctx.functionKubernetesRequest = api.request;
  ctx.pool.query = async () => ({ rows: [{ obligation_id: 'cleanup-a', tenant_id: ws.tenant_id,
    workspace_id: ws.id, resource_id: row.resource_id, correlation_id: 'corr-a', status: 'pending' }] });
  const pending = await FN_HANDLERS.fnDelete(ctx);
  assert.equal(pending.statusCode, 202);
  assert.equal(pending.body.status, 'deletion_pending');
  assert.equal(deleted, false);
  assert.equal([...api.objects.keys()].some((path) => path.includes('/secrets/')), false);
  const service = api.objects.get(`/apis/serving.knative.dev/v1/namespaces/${NS}/services/${row.ksvc_name}`);
  assert.ok(service.metadata.deletionTimestamp);
  assert.deepEqual(service.metadata.finalizers, ['foregroundDeletion']);
  api.collectGarbage();
  const retried = await FN_HANDLERS.fnDelete(ctx);
  assert.equal(retried.statusCode, 202);
  assert.equal(retried.body.status, 'accepted');
  assert.equal(deleted, true);
  assert.equal(api.objects.size, 0);
});

test('rollback resolves the retained names from OpenBao rather than losing the secret declaration', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const ctx = context();
  ctx.functionKubernetesRequest = api.request;
  ctx.params = { actionId: row.resource_id };
  ctx.body = { versionId: 'fnv_old123' };
  ctx.store.getFnAction = async () => row;
  ctx.store.listFnActionVersions = async () => [{ ...row, version_id: 'fnv_old123', status: 'historical', version_number: 1 }, { ...row, version_id: 'fnv_new123', status: 'active', version_number: 2 }];
  ctx.store.activateFnActionVersion = async () => row;
  delete ctx.deployKnativeService;
  const result = await FN_HANDLERS.fnRollback(ctx);
  assert.equal(result.statusCode, 202);
  assert.deepEqual(api.objects.get(`/api/v1/namespaces/${NS}/secrets/fn-app-secrets`)?.data, { API_KEY: Buffer.from('synthetic-marker').toString('base64') });
});

test('a failed deploy with failed rollback retains a Function record and a cleanup obligation', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const ctx = context();
  delete ctx.deployKnativeService;
  ctx.functionKubernetesRequest = async (method, path, body, options) => {
    if ((method === 'POST' && path.endsWith('/services')) || (method === 'DELETE' && path.includes('/secrets/'))) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
    return api.request(method, path, body, options);
  };
  ctx.pool.query = async (_sql, params) => ({ rows: [{ obligation_id: 'cleanup-a', tenant_id: ws.tenant_id, workspace_id: ws.id, resource_id: params[2], correlation_id: 'corr-a', status: 'pending' }] });
  const result = await FN_HANDLERS.fnDeploy(ctx);
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.status, 'cleanup_pending');
  assert.equal(typeof result.body.resourceId, 'string');
  assert.equal((await ctx.store.listFnActions()).length, 1);
  assert.equal(result.body.obligations[0].obligationId, 'cleanup-a');
});

test('failed redeploy and Secret restoration preserve the existing Function and allow retry', async (t) => {
  installInvocationFixture(t, invocationFixture());
  for (const byName of [false, true]) {
    const api = cluster();
    const ctx = context();
    delete ctx.deployKnativeService;
    const original = { ...row, action_name: 'hello', lifecycle_status: 'active' };
    let current = structuredClone(original);
    const versions = [{ version_id: 'fnv_original', source_code: 'return 1', secret_refs: refs }];
    ctx.store.getFnAction = async () => current;
    ctx.store.getFnActionByName = async () => current;
    ctx.store.listFnActions = async () => [current];
    ctx.store.upsertFnAction = async (_pool, action) => {
      current = { ...current, source_code: action.sourceCode, secret_refs: action.secretRefs };
      versions.push({ source_code: action.sourceCode, secret_refs: action.secretRefs });
      return current;
    };
    const obligations = [];
    ctx.runtimeCleanupRepository = { deferFunctionDeletion: async (obligation) => {
      obligations.push(obligation);
      current.lifecycle_status = 'deletion_pending';
      return obligation;
    } };
    if (!byName) ctx.params.actionId = row.resource_id;
    ctx.body.source.inlineCode = 'return 2';
    ctx.body.execution.secrets = [{ name: 'other-key', env: 'OTHER_KEY' }];
    ctx.vaultStore.resolveEnv = async () => [{ name: 'OTHER_KEY', value: 'synthetic-marker' }];
    const servicePath = `/apis/serving.knative.dev/v1/namespaces/${NS}/services/${row.ksvc_name}`;
    await deployKnativeService(row.ksvc_name, row.source_code, { tenantId: ws.tenant_id,
      workspaceId: ws.id, functionResourceId: row.resource_id, request: api.request,
      secretEnv: [{ name: 'API_KEY', value: 'original-marker' }] });
    const originalService = structuredClone(api.objects.get(servicePath));
    let rejectedService = false;
    let rejectedRestore = false;
    ctx.functionKubernetesRequest = async (method, path, body, options) => {
      if (method === 'PATCH' && path === servicePath) {
        rejectedService = true;
        throw Object.assign(new Error('synthetic-marker'), { statusCode: 503 });
      }
      if (rejectedService && method === 'GET' && path.includes('/secrets/')) {
        rejectedRestore = true;
        throw Object.assign(new Error('synthetic-marker'), { statusCode: 503 });
      }
      return api.request(method, path, body, options);
    };
    const result = await FN_HANDLERS.fnDeploy(ctx);
    assert.equal(result.statusCode, 502);
    assert.equal(rejectedService, true);
    assert.equal(rejectedRestore, true);
    assert.deepEqual(current, original);
    assert.deepEqual(versions, [{ version_id: 'fnv_original', source_code: 'return 1', secret_refs: refs }]);
    assert.deepEqual(obligations, []);
    assert.deepEqual(api.objects.get(servicePath), originalService);
    assert.equal(JSON.stringify(result).includes('synthetic-marker'), false);
    assert.match(result.body.message, /retry.*deploy/i);
    ctx.functionKubernetesRequest = api.request;
    assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 202);
    assert.equal(current.source_code, 'return 2');
    assert.deepEqual(current.secret_refs, [{ name: 'other-key', env: 'OTHER_KEY' }]);
    assert.equal(versions.length, 2);
  }
});

test('metadata counts a Function once even when it maps a secret to several env vars', async () => {
  const ctx = context();
  ctx.store.listFnActions = async () => [{ ...row, secret_refs: [...refs, { name: 'api-key', env: 'OTHER_KEY' }] }];
  ctx.vaultStore.list = async () => [{ name: 'api-key' }];
  assert.equal((await FN_HANDLERS.secretGet(ctx)).body.resolvedRefCount, 1);
  assert.equal((await FN_HANDLERS.secretList(ctx)).body.items[0].resolvedRefCount, 1);
});
test('reserved mappings and foreign workspace declarations are rejected before Kubernetes writes', async () => {
  for (const [reference, statusCode] of [[{ name: 'api-key', env: 'FN_SRC' }, 400], [{ name: 'api-key', env: 'KEY', workspaceId: 'foreign' }, 403]]) {
    const ctx = context();
    ctx.body.execution.secrets = [reference];
    ctx.vaultStore.resolveEnv = async () => assert.fail('must not resolve a rejected declaration');
    ctx.deployKnativeService = async () => assert.fail('must not deploy a rejected declaration');
    assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, statusCode);
  }
});
test('missing backend and missing declared source secrets fail closed', async () => {
  const ctx = context();
  ctx.deployKnativeService = async () => assert.fail('must not deploy without source material');
  ctx.vaultStore = null;
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 501);
  ctx.vaultStore = { resolveEnv: async () => [] };
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 400);
});

test('rollback uses the same fail-closed, redacted secret resolution responses as deploy', async () => {
  for (const [backend, statusCode] of [[null, 501], [{ resolveEnv: async () => [] }, 400],
    [{ resolveEnv: async () => { throw new Error('synthetic-marker'); } }, 502]]) {
    const ctx = context();
    ctx.params = { actionId: row.resource_id };
    ctx.body = { versionId: 'fnv_old123' };
    ctx.store.getFnAction = async () => row;
    ctx.store.listFnActionVersions = async () => [{ ...row, version_id: 'fnv_old123', status: 'historical', version_number: 1 },
      { ...row, version_id: 'fnv_new123', status: 'active', version_number: 2 }];
    ctx.vaultStore = backend;
    ctx.deployKnativeService = async () => assert.fail('must not deploy without source material');
    const result = await FN_HANDLERS.fnRollback(ctx);
    assert.equal(result.statusCode, statusCode);
    assert.equal(JSON.stringify(result).includes('synthetic-marker'), false);
  }
});

test('rotation reports legacy objects still awaiting controller reconciliation', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const ctx = context();
  ctx.functionKubernetesRequest = api.request;
  ctx.store.listFnActions = async () => [row];
  ctx.vaultStore.validName = () => true;
  ctx.vaultStore.exists = async () => true;
  ctx.vaultStore.replace = async () => ({ name: 'api-key' });
  ctx.body = { value: 'next-marker' };
  await deployKnativeService(row.ksvc_name, 'return 1', { tenantId: ws.tenant_id, workspaceId: ws.id, functionResourceId: row.resource_id, request: api.request, secretEnv: [{ name: 'API_KEY', value: 'old-marker' }] });
  const svc = api.objects.get(`/apis/serving.knative.dev/v1/namespaces/${NS}/services/fn-app`);
  api.objects.set(`/apis/serving.knative.dev/v1/namespaces/${NS}/configurations/fn-app`, { metadata: { name: 'fn-app', uid: 'config-old', resourceVersion: '1', ownerReferences: [{ uid: svc.metadata.uid }] }, spec: { template: { spec: { containers: [{ env: [{ name: 'API_KEY', value: 'old-marker' }] }] } } } });
  const result = await FN_HANDLERS.secretReplace(ctx);
  assert.equal(result.statusCode, 502);
  assert.deepEqual(result.body.affectedFunctions, ['fn-a']);
  assert.deepEqual(result.body.pendingResources.map((r) => r.kind), ['Configuration']);
  assert.equal(JSON.stringify(result).includes('old-marker'), false);
});

test('a concurrent deploy cannot republish a value after workspace-secret revocation', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const ctx = context();
  delete ctx.deployKnativeService;
  let value = 'race-marker';
  let started;
  const projectionStarted = new Promise((resolve) => { started = resolve; });
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  ctx.vaultStore = { validName: () => true, exists: async () => value !== null, delete: async () => { value = null; },
    resolveEnv: async (_t, _w, declared) => value !== null && declared.length ? [{ name: 'API_KEY', value }] : [],
  };
  ctx.functionKubernetesRequest = async (method, path, body, options) => {
    if (method === 'POST' && path.endsWith('/secrets')) { started(); await paused; }
    return api.request(method, path, body, options);
  };
  const deployed = FN_HANDLERS.fnDeploy(ctx);
  await projectionStarted;
  const revoked = FN_HANDLERS.secretDelete(ctx);
  await new Promise(setImmediate); // Drain the competing handler while the Kubernetes write is paused.
  resume();
  assert.equal((await deployed).statusCode, 202);
  const deleted = await revoked;
  assert.equal(deleted.statusCode, 204);
  assert.equal(deleted.headers['x-falcone-resolved-ref-count'], '1');
  assert.equal([...api.objects.keys()].some((path) => path.includes('/secrets/')), false);
});

test('a Function awaiting durable cleanup cannot be redeployed with secret material', async () => {
  const ctx = context();
  ctx.params.actionId = row.resource_id;
  ctx.store.getFnAction = async () => ({ ...row, lifecycle_status: 'deletion_pending' });
  const result = await FN_HANDLERS.fnDeploy(ctx);
  assert.equal(result.statusCode, 409);
  assert.equal((await ctx.store.listFnActions()).length, 0);
});

test('repeated create for the same named Function preserves its projection ownership identity', async () => {
  const ctx = context();
  ctx.store.getFnActionByName = async () => ({ ...row, action_name: 'hello' });
  let ownership;
  let deployedName;
  ctx.deployKnativeService = async (name, _source, opts) => { ownership = opts.functionResourceId; deployedName = name; };
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 202);
  assert.equal(ownership, 'fn-a');
  assert.equal(deployedName, 'fn-app');
});
