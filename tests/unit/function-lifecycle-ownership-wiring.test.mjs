/**
 * Regression coverage for the remaining Function lifecycle paths that must bind their Knative
 * deploy to the resolved (tenant, function) owner (issue #933, add-managed-knative-serving,
 * blocker 2).
 *
 * managed-knative-function-cleanup-ownership.test.mjs already pins the executor's ownership labels
 * and the fnDelete / fnDeploy-create wiring. It does NOT cover two paths that also re-materialise the
 * Knative Service and therefore must re-stamp ownership, or the ksvc becomes an unlabeled orphan that
 * a later ownership-verified delete refuses to remove:
 *   - fnRollback re-deploys a retained revision, and
 *   - fnDeploy UPDATE reuses the STABLE existing resource id so the ownership label never moves.
 *
 * Driven through the public FN_HANDLERS surface with injected store/executor seams — no cluster.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

const NOW = '2026-08-07T10:00:00.000Z';
const WS = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app', created_at: NOW };
const OWNER = {
  sub: 'dev-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner',
  roles: ['workspace_owner'], scopes: [],
};
const READY_RUNTIME = {
  functionsEnabled: true,
  status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }),
  canServeWorkloads: () => true,
};

function baseCtx(extra = {}) {
  return {
    pool: {}, params: {}, body: {}, query: {}, identity: OWNER, knativeRuntime: READY_RUNTIME,
    callerContext: { correlationId: 'corr-a', tenantId: 'tenant-a', workspaceId: 'ws-a' },
    ...extra,
  };
}

test('fn-lifecycle-own-01: fnRollback re-deploys the retained revision under the same (tenant, function) owner', async () => {
  const action = {
    resource_id: 'fn-a', tenant_id: 'tenant-a', workspace_id: 'ws-a', action_name: 'hello',
    ksvc_name: 'fn-app-hello-abcd', version: 2,
  };
  const versions = [
    { version_id: 'fnv_active', version_number: 2, status: 'active', tenant_id: 'tenant-a', workspace_id: 'ws-a' },
    { version_id: 'fnv_0', version_number: 0, status: 'historical', tenant_id: 'tenant-a', workspace_id: 'ws-a', source_code: 'old', memory_mb: 128, timeout_ms: 30000, ksvc_name: 'fn-app-hello-abcd' },
  ];
  const deploys = [];
  const ctx = baseCtx({
    params: { actionId: 'fn-a' }, body: { versionId: 'fnv_0' },
    store: {
      getFnAction: async (_p, id, tenantId) => (id === 'fn-a' && tenantId === 'tenant-a' ? action : null),
      listFnActionVersions: async () => versions,
      activateFnActionVersion: async () => ({ ...action, version: 1 }),
    },
    deployKnativeService: async (_name, _source, options) => { deploys.push(options); },
  });
  const result = await FN_HANDLERS.fnRollback(ctx);
  assert.equal(result.statusCode, 202);
  assert.equal(deploys.length, 1);
  assert.equal(deploys[0].workspaceId, 'ws-a');
  assert.deepEqual(
    { tenantId: deploys[0].tenantId, functionResourceId: deploys[0].functionResourceId },
    { tenantId: 'tenant-a', functionResourceId: 'fn-a' },
  );
});

test('fn-lifecycle-own-02: fnDeploy UPDATE reuses the STABLE resource id so the ownership label never moves', async () => {
  const existing = { resource_id: 'fn_known01', tenant_id: 'tenant-a', workspace_id: 'ws-a', action_name: 'hello', ksvc_name: 'fn-app-hello-abcd' };
  const deploys = [];
  const ctx = baseCtx({
    params: { actionId: 'fn_known01' },
    body: { workspaceId: 'ws-a', actionName: 'hello', source: { inlineCode: 'export function main() { return { v: 2 } }' } },
    store: {
      getWorkspace: async () => WS,
      getFnAction: async (_p, id, tenantId) => (id === 'fn_known01' && tenantId === 'tenant-a' ? existing : null),
      upsertFnAction: async (_p, input) => ({ ...input, resource_id: input.resourceId, created_at: NOW, updated_at: NOW, version: 2 }),
    },
    deployKnativeService: async (_name, _source, options) => { deploys.push(options); },
  });
  const result = await FN_HANDLERS.fnDeploy(ctx);
  assert.equal(result.statusCode, 202);
  assert.equal(deploys.length, 1);
  assert.equal(deploys[0].workspaceId, 'ws-a');
  assert.equal(deploys[0].tenantId, 'tenant-a');
  assert.equal(deploys[0].functionResourceId, 'fn_known01', 'an update must reuse the stable function id');
});

test('fnDeploy create/PATCH reject reserved secret env mappings with 400 before resolution or mutations', async () => {
  const existing = { resource_id: 'fn_known01', tenant_id: WS.tenant_id, workspace_id: WS.id };
  const reservedRefs = [
    'fn-src', 'fn-ksvc-name', 'fn-tenant-id', 'fn-workspace-id',
    'fn-invocation-private-key', 'fn-invocation-key-id', 'fn-invocation-jwks',
    'k-service', 'node-options', 'node-path',
    { name: 'fn-src' }, { secretName: 'fn-src' },
    { name: 'api-token', env: 'FN_INVOCATION_PRIVATE_KEY' },
    { secretName: 'api-token', env: 'FN_INVOCATION_JWKS' },
    { name: 'api-token', env: 'K_SERVICE' },
    { name: 'api-token', env: 'NODE_OPTIONS' },
    { name: 'api-token', env: 'NODE_PATH' },
  ];
  for (const params of [{}, { actionId: existing.resource_id }]) {
    for (const ref of reservedRefs) {
      for (const secrets of [{ execution: { secrets: [ref] } }, { secrets: [ref] }]) {
        const sideEffects = [];
        const result = await FN_HANDLERS.fnDeploy(baseCtx({
          params,
          body: { workspaceId: WS.id, actionName: 'hello', source: { inlineCode: 'function main(){}' }, ...secrets },
          store: {
            getWorkspace: async () => WS,
            getFnAction: async () => existing,
            upsertFnAction: async () => { sideEffects.push('write'); },
          },
          deployKnativeService: async () => { sideEffects.push('deploy'); },
        }));
        assert.equal(result.statusCode, 400);
        assert.equal(result.body.code, 'VALIDATION_ERROR');
        assert.match(result.body.message, /different env mapping/);
        assert.deepEqual(sideEffects, []);
      }
    }
  }
});

test('fnDeploy preserves workspace authorization before reserved secret validation', async () => {
  const result = await FN_HANDLERS.fnDeploy(baseCtx({
    body: { workspaceId: 'ws-foreign', actionName: 'hello', source: { inlineCode: 'function main(){}' }, secrets: ['fn-src'] },
    store: { getWorkspace: async () => ({ id: 'ws-foreign', tenant_id: 'tenant-b' }) },
  }));
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.code, 'FORBIDDEN');
});
