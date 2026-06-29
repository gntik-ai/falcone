// Unit test for the flow-DEFINITION write role gate (#760 fix-760-flow-write-role-gate).
//
// THE BUG: the cp-executor's flow-definition write handlers gated only on tenant/workspace
// MEMBERSHIP (requireIdentity), never on ROLE. A read-only `tenant_viewer` (and any other
// non-write role, e.g. `tenant_developer`) could create / update / delete / publish a flow
// definition via POST|PATCH|DELETE /v1/flows/workspaces/{ws}/flows[/{flowId}] and POST
// .../versions — a within-tenant privilege escalation (the same token is correctly 403 on every
// kind-control-plane write; cross-tenant isolation already held).
//
// THE FIX: executeFlows role-gates the DEFINITION-WRITE operations (create_definition /
// update_definition / delete_definition / publish_version) AFTER requireIdentity and BEFORE any
// store side effect. A caller whose verified roles are KNOWN (a non-empty array) and contain NO
// write-capable admin role (auth-roles.mjs::WRITE_CAPABLE_ADMIN_ROLES) is rejected with
// 403 FORBIDDEN and the store is never touched. A write-capable role (tenant_owner /
// workspace_admin / superadmin / …) is authorized, preserving today's behavior. An undefined/empty
// roles list DEFERS (no-claims admin token / trusted-gateway / no-DB mode) — unchanged.
//
// These tests encode the issue's WHEN/THEN. They are RED on `main` (no gate → a viewer write
// reaches the store) and GREEN on the branch. The flow store is injected as a RECORDING FAKE:
// a denied write is proven by its mutating-method `calls` array staying empty; an authorized write
// is proven by the matching mutating method being called WITH the caller's verified
// tenantId/workspaceId (the gate must not drop tenant scoping).
//
// Tests: ut-flowrole-01 .. ut-flowrole-14
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFlowExecutor } from '../../apps/control-plane/src/runtime/flow-executor.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const FLOW = '33333333-3333-4333-8333-333333333333';

// A minimal, schema-valid DSL definition so create/update pass assertWriteDefinitionSchema and
// publish passes runValidation for the AUTHORIZED-role paths (the DENIED paths never reach
// validation — the gate fires first).
const MINIMAL_DEF = {
  apiVersion: 'v1.0',
  name: 'minimal-two-step',
  nodes: [
    { id: 'step-1', type: 'task', taskType: 'fetch-record', next: 'step-2' },
    { id: 'step-2', type: 'task', taskType: 'persist-record' },
  ],
};

// Recording fake flow store: every MUTATING method records its args to `calls` and the READ method
// `getDefinition` returns a stored fixture so update/delete/publish pass getDefinitionOr404 for the
// authorized roles. A denied write is proven by `calls` staying empty.
function makeRecordingStore() {
  const calls = [];
  const def = {
    flowId: FLOW,
    name: MINIMAL_DEF.name,
    status: 'draft',
    dslApiVersion: 'v1.0',
    definitionYaml: null,
    definition: MINIMAL_DEF,
    createdBy: 'fixture',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return {
    calls,
    async ensureSchema() {},
    // Reads (NOT gated) — return the fixture so authorized update/delete/publish proceed.
    async getDefinition() { return { ...def }; },
    async listDefinitions() { return [{ ...def }]; },
    async listVersions() { return []; },
    async getVersion() { return null; },
    // Mutations (the methods the WRITE ops call) — record and return a plausible resource.
    async createDefinition(args) {
      calls.push({ method: 'createDefinition', args });
      return { ...def, flowId: args.flowId };
    },
    async updateDefinition(args) {
      calls.push({ method: 'updateDefinition', args });
      return { ...def };
    },
    async deleteDefinition(args) {
      calls.push({ method: 'deleteDefinition', args });
      return { ...def };
    },
    async insertVersion(args) {
      calls.push({ method: 'insertVersion', args });
      return { flowId: args.flowId, version: 1, createdAt: '2026-01-01T00:00:00Z' };
    },
  };
}

// A fake @temporalio/client-shaped object: workflow.list yields nothing so hasActiveExecutions
// (used by delete_definition) returns false and the delete proceeds to store.deleteDefinition for
// the authorized roles. Mirrors makeFakeTemporal in flow-executor-workflow-id.test.mjs.
function makeFakeTemporal() {
  return {
    workflow: {
      // eslint-disable-next-line require-yield
      async *list() { /* no running executions */ },
      getHandle() { return {}; },
      async start() { return {}; },
    },
  };
}

function makeExecutor(store) {
  return createFlowExecutor({
    store,
    temporalClient: makeFakeTemporal(),
    temporalAddress: 'fake:7233',
    logger: { error() {}, warn() {} },
  });
}

// Identities in the EXECUTOR shape ({ tenantId, workspaceId, roles, actorId }). roles mirrors the
// verified token's realm_access.roles (jwt-verify.mjs::deriveIdentityFromClaims).
const viewer = { tenantId: TENANT, workspaceId: WORKSPACE, actorId: 'viewer', roles: ['tenant_viewer'] };
// A non-write developer role: the gate denies ANY non-write role, which also closes the flows
// slice of #773 — correct and in-scope as a consequence of the role model.
const developer = { tenantId: TENANT, workspaceId: WORKSPACE, actorId: 'dev', roles: ['tenant_developer'] };
const owner = { tenantId: TENANT, workspaceId: WORKSPACE, actorId: 'owner', roles: ['tenant_owner'] };
const wsadmin = { tenantId: TENANT, workspaceId: WORKSPACE, actorId: 'wsadmin', roles: ['workspace_admin'] };
const superadmin = { tenantId: TENANT, workspaceId: WORKSPACE, actorId: 'root', roles: ['superadmin'] };

// The four DEFINITION-WRITE operations the gate covers, with the params each needs.
const WRITE_OPS = [
  { operation: 'create_definition', extra: { body: { name: 'new-flow', definition: MINIMAL_DEF } }, mutator: 'createDefinition' },
  { operation: 'update_definition', extra: { flowId: FLOW, body: { name: 'renamed', definition: MINIMAL_DEF } }, mutator: 'updateDefinition' },
  { operation: 'delete_definition', extra: { flowId: FLOW }, mutator: 'deleteDefinition' },
  { operation: 'publish_version', extra: { flowId: FLOW }, mutator: 'insertVersion' },
];

const assert403 = (err) => {
  assert.equal(err.statusCode, 403, 'a non-write role must get HTTP 403');
  assert.equal(err.code, 'FORBIDDEN', "the code must be 'FORBIDDEN'");
  return true;
};

// -- DENIED: read-only viewer cannot create/update/delete/publish, and NOTHING is persisted ------

for (const { operation, extra } of WRITE_OPS) {
  // ut-flowrole-01..04
  test(`ut-flowrole: viewer is denied 403 on ${operation} and the store is never touched`, async () => {
    const store = makeRecordingStore();
    const executor = makeExecutor(store);
    try {
      await assert.rejects(
        () => executor.executeFlows({ operation, identity: viewer, ...extra }),
        assert403,
      );
      assert.equal(store.calls.length, 0, `${operation}: no store mutation may occur for a denied viewer`);
    } finally {
      await executor.close().catch(() => {});
    }
  });
}

// -- DENIED: a non-write developer role is likewise rejected (closes the flows slice of #773) -----

for (const { operation, extra } of WRITE_OPS) {
  // ut-flowrole-05..08
  test(`ut-flowrole: developer (non-write role) is denied 403 on ${operation}, store untouched`, async () => {
    const store = makeRecordingStore();
    const executor = makeExecutor(store);
    try {
      await assert.rejects(
        () => executor.executeFlows({ operation, identity: developer, ...extra }),
        assert403,
      );
      assert.equal(store.calls.length, 0, `${operation}: no store mutation for a denied developer`);
    } finally {
      await executor.close().catch(() => {});
    }
  });
}

// -- AUTHORIZED: write-capable roles still succeed, scoped by the caller's tenant/workspace -------

for (const identity of [owner, wsadmin, superadmin]) {
  for (const { operation, extra, mutator } of WRITE_OPS) {
    // ut-flowrole-09..14 (3 roles × 4 ops)
    test(`ut-flowrole: ${identity.roles[0]} is authorized on ${operation} (store.${mutator} called, tenant-scoped)`, async () => {
      const store = makeRecordingStore();
      const executor = makeExecutor(store);
      try {
        const result = await executor.executeFlows({ operation, identity, ...extra });
        assert.ok(result, `${operation} must resolve for ${identity.roles[0]}`);
        const call = store.calls.find((c) => c.method === mutator);
        assert.ok(call, `${operation}: store.${mutator} must be called for an authorized ${identity.roles[0]}`);
        // No-weakening guard: the authorized store call stays scoped to the CALLER'S verified
        // tenant/workspace (the fix must not drop tenant scoping).
        assert.equal(call.args.tenantId, TENANT, `${operation}: store call must carry the caller's tenantId`);
        assert.equal(call.args.workspaceId, WORKSPACE, `${operation}: store call must carry the caller's workspaceId`);
      } finally {
        await executor.close().catch(() => {});
      }
    });
  }
}
