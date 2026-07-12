// bbx-flows-ten-actgate
//
// Per-execution credential gate at activity dispatch (change add-flows-tenancy-isolation-limits).
// Drives the worker's PUBLIC dispatchTask seam with a token carried in the tenant envelope and
// proves that a REGISTERED (first-party, data-touching) activity validates the token BEFORE any
// downstream data-store call. Expired or cross-tenant tokens fail non-retryably with NO downstream
// access; a valid token proceeds; an unregistered taskType (interpreter echo seam) is unaffected.
//
// Scenarios:
//   bbx-flows-ten-actgate-01: valid token → activity proceeds, downstream executor IS called
//   bbx-flows-ten-actgate-02: expired token → EXECUTION_TOKEN_EXPIRED, NO downstream call
//   bbx-flows-ten-actgate-03: cross-tenant token → EXECUTION_TOKEN_TENANT_MISMATCH, NO downstream call
//   bbx-flows-ten-actgate-04: no token at all → gate is a no-op (legacy harness path)
//   bbx-flows-ten-actgate-05: unregistered taskType (echo seam) is not token-gated
import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatchTask } from '../../apps/workflow-worker/src/activities/index.mjs';
import { mintExecutionToken } from '../../apps/control-plane-executor/src/runtime/execution-token.mjs';

function dbQueryInput(token, { tenantId = 'tenant_A', workspaceId = 'ws_A' } = {}) {
  return {
    nodeId: 'n1',
    taskType: 'db.query',
    params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 's', tableName: 't', workspaceId },
    tenant: { tenantId, workspaceId, ...(token !== undefined ? { executionToken: token } : {}) },
  };
}

test('bbx-flows-ten-actgate-01: valid token → activity proceeds, downstream executor called', async () => {
  let called = false;
  const token = mintExecutionToken('tenant_A', 'ws_A');
  await dispatchTask(dbQueryInput(token), {
    executePostgresData: async () => { called = true; return { items: [] }; },
    pgRegistry: {},
  });
  assert.equal(called, true, 'a valid token lets the activity reach the data store');
});

test('bbx-flows-ten-actgate-02: expired token → EXECUTION_TOKEN_EXPIRED, no downstream call', async () => {
  let called = false;
  const expired = mintExecutionToken('tenant_A', 'ws_A', 1, { now: 0 });
  await assert.rejects(
    () => dispatchTask(dbQueryInput(expired), { executePostgresData: async () => { called = true; return {}; }, pgRegistry: {} }),
    (err) => err.type === 'EXECUTION_TOKEN_EXPIRED' && err.nonRetryable === true,
  );
  assert.equal(called, false, 'an expired token blocks all data access');
});

test('bbx-flows-ten-actgate-03: cross-tenant token → EXECUTION_TOKEN_TENANT_MISMATCH, no downstream call', async () => {
  let called = false;
  // Token minted for tenant_B but the execution envelope claims tenant_A.
  const foreign = mintExecutionToken('tenant_B', 'ws_A');
  await assert.rejects(
    () => dispatchTask(dbQueryInput(foreign, { tenantId: 'tenant_A', workspaceId: 'ws_A' }), { executePostgresData: async () => { called = true; return {}; }, pgRegistry: {} }),
    (err) => err.type === 'EXECUTION_TOKEN_TENANT_MISMATCH' && err.nonRetryable === true,
  );
  assert.equal(called, false);
});

test('bbx-flows-ten-actgate-04: no token at all → gate is a no-op (legacy harness path)', async () => {
  let called = false;
  await dispatchTask(dbQueryInput(undefined), { executePostgresData: async () => { called = true; return { items: [] }; }, pgRegistry: {} });
  assert.equal(called, true, 'a missing token does not block the legacy interpreter harness');
});

test('bbx-flows-ten-actgate-05: unregistered taskType (echo seam) is not token-gated', async () => {
  const out = await dispatchTask({ nodeId: 'n1', taskType: 'noop-a', params: { x: 1 }, tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A', executionToken: 'garbage' } }, {});
  assert.equal(out.output.executed, true, 'graph-walk placeholder activities echo regardless of token');
});
