// Black-box test suite for change fix-async-operation-trusted-context
//
// Drives the PUBLIC action entrypoints (`main`) of async-operation-query.mjs
// and async-operation-create.mjs only — identity must be derived EXCLUSIVELY
// from gateway-injected headers on params.__ow_headers, never from
// caller-supplied params.callerContext.
//
// Core vulnerability: any caller can inject
//   callerContext: { actor: { id:'x', type:'superadmin' }, tenantId:'<victim>' }
// to bypass tenant isolation or escalate to superadmin. The fix ensures that
// callerContext is never read from the request body.
//
// Tests:
//   bbx-async-op-trust-01: body-injected superadmin (no trusted headers) → 401, no DB read
//   bbx-async-op-trust-02: body claims superadmin but trusted headers say tenant_admin → scoped to header tenant, cross-tenant filter rejected (403)
//   bbx-async-op-trust-03: valid trusted tenant headers → query proceeds scoped to header tenant
//   bbx-async-op-trust-04: valid trusted headers with x-actor-type superadmin → superadmin cross-tenant path works
//   bbx-async-op-trust-05: no identity headers at all → 401 for query
//   bbx-async-op-trust-06: body-injected callerContext (no trusted headers) → 401 on create
//   bbx-async-op-trust-07: valid trusted tenant headers → create proceeds with header tenant identity
//   bbx-async-op-trust-08: no identity headers at all → 401 for create

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  main as queryMain,
  buildQueryActionDependencies
} from '../../services/provisioning-orchestrator/src/actions/async-operation-query.mjs';
import {
  main as createMain
} from '../../services/provisioning-orchestrator/src/actions/async-operation-create.mjs';

const TENANT_VICTIM = 'ten_VICTIM';
const TENANT_A = 'ten_A';
const TENANT_B = 'ten_B';
const ACTOR_USR_A = 'usr_a';

// A db stub that records list calls so we can assert nothing was queried.
function fakeQueryDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

// Minimal overrides that stub the DB layer for query action.
function queryOverrides(db, extraRows = []) {
  return {
    db,
    listOperations: async (dbArg, opts) => {
      db.calls.push({ op: 'listOperations', opts });
      return { items: extraRows, total: extraRows.length, pagination: { limit: 10, offset: 0 } };
    },
    getOperationById: async () => null,
    getOperationLogs: async () => ({ entries: [], total: 0, pagination: {} }),
    getOperationResult: async () => null,
    publishAuditEvent: async () => {},
    log: () => {}
  };
}

// Minimal overrides for create action (no DB transaction needed for these tests).
function createOverrides() {
  return {
    db: fakeQueryDb(),
    persistOperation: async (db, op) => ({ ...op, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    findActiveIdempotencyKey: async () => null,
    insertOrFindIdempotencyKey: async () => ({ created: true, record: null }),
    createIdempotencyKeyRecord: (args) => args,
    hashParams: () => 'hash:x',
    publishStateChanged: async () => {},
    publishDeduplicationEvent: async () => {},
    log: () => {}
  };
}

// bbx-async-op-trust-01
// Body-injected superadmin WITHOUT trusted gateway headers must be rejected with 401.
// The current vulnerable code returns 400 (missing db) or worse processes the query.
test('bbx-async-op-trust-01: body-injected superadmin without trusted headers returns 401 on query', async () => {
  const db = fakeQueryDb();
  const result = await queryMain(
    {
      // attacker-controlled body — must be completely ignored for identity
      callerContext: { actor: { id: 'attacker', type: 'superadmin' }, tenantId: TENANT_VICTIM },
      queryType: 'list',
      filters: { tenantId: TENANT_VICTIM }
      // NO __ow_headers — no trusted gateway identity
    },
    queryOverrides(db)
  );

  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
  assert.ok(result.body?.code === 'UNAUTHORIZED' || result.body?.error?.includes?.('UNAUTHORIZED') || String(result.body).includes('UNAUTHORIZED') || result.statusCode === 401, 'expected UNAUTHORIZED response');
  // No DB list operation should have run for the victim tenant
  const listCalls = db.calls.filter((c) => c.op === 'listOperations' || (c.sql && /async_operations/i.test(c.sql)));
  assert.equal(listCalls.length, 0, `expected 0 DB list calls, got ${listCalls.length}`);
});

// bbx-async-op-trust-02
// Body claims superadmin but trusted headers say workspace_admin for ten_A,
// and filter asks for ten_B → body ignored, identity from header (workspace_admin/ten_A),
// cross-tenant filter rejected (403 TENANT_ISOLATION_VIOLATION).
test('bbx-async-op-trust-02: body superadmin claim ignored; trusted headers workspace_admin scopes to header tenant; cross-tenant filter rejected', async () => {
  const db = fakeQueryDb();
  let result;
  try {
    result = await queryMain(
      {
        callerContext: { actor: { id: 'attacker', type: 'superadmin' }, tenantId: TENANT_B },
        queryType: 'list',
        filters: { tenantId: TENANT_B },
        __ow_headers: {
          'x-tenant-id': TENANT_A,
          'x-auth-subject': ACTOR_USR_A,
          'x-actor-type': 'workspace_admin'
        }
      },
      queryOverrides(db)
    );
  } catch (err) {
    // Thrown error path: check for TENANT_ISOLATION_VIOLATION
    assert.ok(
      err.code === 'TENANT_ISOLATION_VIOLATION' || err.statusCode === 403,
      `expected TENANT_ISOLATION_VIOLATION or 403, got code=${err.code} statusCode=${err.statusCode}`
    );
    return;
  }
  // Returned result path
  assert.equal(result.statusCode, 403, `expected 403 isolation violation, got ${result.statusCode}`);
});

// bbx-async-op-trust-03
// Valid trusted headers for a tenant actor → query proceeds scoped to header tenant.
test('bbx-async-op-trust-03: valid trusted tenant headers → query scoped to header tenant, not body', async () => {
  const db = fakeQueryDb();
  const result = await queryMain(
    {
      // body callerContext is completely absent — identity from headers alone
      queryType: 'list',
      filters: { tenantId: TENANT_A },
      __ow_headers: {
        'x-tenant-id': TENANT_A,
        'x-auth-subject': ACTOR_USR_A,
        'x-actor-type': 'workspace_admin'
      }
    },
    queryOverrides(db)
  );

  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body?.queryType, 'list', 'expected queryType=list in body');
  // Verify the listOperations call used TENANT_A scope
  const listCall = db.calls.find((c) => c.op === 'listOperations');
  assert.ok(listCall, 'expected a listOperations call');
  assert.equal(listCall.opts.tenant_id, TENANT_A, `expected tenant_id=${TENANT_A}, got ${listCall.opts.tenant_id}`);
});

// bbx-async-op-trust-04
// Valid trusted headers with x-actor-type=superadmin → superadmin cross-tenant path works.
test('bbx-async-op-trust-04: trusted x-actor-type=superadmin header → superadmin cross-tenant query works', async () => {
  const db = fakeQueryDb();
  const result = await queryMain(
    {
      queryType: 'list',
      filters: { tenantId: TENANT_VICTIM },
      __ow_headers: {
        'x-tenant-id': 'ten_ADMIN',
        'x-auth-subject': 'admin_user',
        'x-actor-type': 'superadmin'
      }
    },
    queryOverrides(db)
  );

  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  // Superadmin can scope to the victim tenant via filters
  const listCall = db.calls.find((c) => c.op === 'listOperations');
  assert.ok(listCall, 'expected a listOperations call');
  assert.equal(listCall.opts.tenant_id, TENANT_VICTIM, `expected listOperations scoped to ${TENANT_VICTIM}`);
  assert.equal(listCall.opts.isSuperadmin, true, 'expected isSuperadmin=true for superadmin actor');
});

// bbx-async-op-trust-05
// No identity headers at all → 401 on query.
test('bbx-async-op-trust-05: no identity headers at all returns 401 on query', async () => {
  const db = fakeQueryDb();
  const result = await queryMain(
    {
      queryType: 'list',
      filters: {},
      __ow_headers: {}
    },
    queryOverrides(db)
  );

  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
});

// bbx-async-op-trust-06
// Body-injected callerContext without trusted headers → 401 on create.
test('bbx-async-op-trust-06: body-injected callerContext without trusted headers returns 401 on create', async () => {
  let result;
  try {
    result = await createMain(
      {
        callerContext: { actor: { id: 'attacker', type: 'superadmin' }, tenantId: TENANT_VICTIM },
        operation_type: 'create-workspace'
        // NO __ow_headers
      },
      createOverrides()
    );
  } catch (err) {
    // The action may throw instead of returning a status object; both are fine as long as it's 401.
    assert.ok(
      err.statusCode === 401 || err.code === 'UNAUTHORIZED',
      `expected 401/UNAUTHORIZED, got code=${err.code} statusCode=${err.statusCode}`
    );
    return;
  }
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
});

// bbx-async-op-trust-07
// Valid trusted tenant headers → create proceeds with header tenant identity.
test('bbx-async-op-trust-07: valid trusted tenant headers → create scoped to header tenant', async () => {
  let persistedOp = null;
  const overrides = {
    ...createOverrides(),
    persistOperation: async (db, op) => {
      persistedOp = op;
      return {
        ...op,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
  };

  const result = await createMain(
    {
      operation_type: 'create-workspace',
      workspace_id: 'ws-01',
      __ow_headers: {
        'x-tenant-id': TENANT_A,
        'x-auth-subject': ACTOR_USR_A,
        'x-actor-type': 'workspace_admin'
      }
    },
    overrides
  );

  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.ok(persistedOp, 'expected persistOperation to be called');
  assert.equal(persistedOp.tenant_id, TENANT_A, `expected tenant_id=${TENANT_A}, got ${persistedOp.tenant_id}`);
  assert.equal(persistedOp.actor_id, ACTOR_USR_A, `expected actor_id=${ACTOR_USR_A}, got ${persistedOp.actor_id}`);
});

// bbx-async-op-trust-08
// No identity headers at all → 401 for create.
test('bbx-async-op-trust-08: no identity headers at all returns 401 on create', async () => {
  let result;
  try {
    result = await createMain(
      {
        operation_type: 'create-workspace',
        __ow_headers: {}
      },
      createOverrides()
    );
  } catch (err) {
    assert.ok(
      err.statusCode === 401 || err.code === 'UNAUTHORIZED',
      `expected 401/UNAUTHORIZED, got code=${err.code} statusCode=${err.statusCode}`
    );
    return;
  }
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
});
