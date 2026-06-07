// Black-box test suite for change derive-scheduling-identity-from-token.
// Drives the PUBLIC action entrypoint (`main`) only — fake pg injected via params.
// Covers all 5 acceptance scenarios from the spec delta.
//
// Tests: bbx-sched-identity-no-jwt, bbx-sched-identity-jwt-scope,
//        bbx-sched-identity-missing-tenantid, bbx-sched-identity-missing-workspaceid,
//        bbx-sched-identity-tenant-scope
import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../services/scheduling-engine/actions/scheduling-management.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'wsaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_B = 'wsbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fakePg(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

// bbx-sched-identity-no-jwt
// Scenario 1: request body has tenantId/workspaceId but NO jwt → HTTP 401 UNAUTHENTICATED,
// no scheduling DB operation runs.
test('bbx-sched-identity-no-jwt: body tenantId/workspaceId without JWT returns 401 UNAUTHENTICATED with no DB queries', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    // no jwt field — attacker injects identity via body/params
    tenantId: TENANT_A,
    workspaceId: WS_A,
  });

  assert.equal(result.statusCode, 401, `expected statusCode 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHENTICATED', `expected code UNAUTHENTICATED, got ${result.body?.code}`);

  const dbQueries = pg.calls.filter(
    (c) => /scheduled_jobs/i.test(c.sql) || /scheduling_config/i.test(c.sql),
  );
  assert.equal(
    dbQueries.length,
    0,
    `expected NO scheduling DB queries, but got ${dbQueries.length}: ${JSON.stringify(dbQueries.map((c) => c.sql))}`,
  );
});

// bbx-sched-identity-jwt-scope
// Scenario 2: valid JWT present with tenantId=A; conflicting tenantId=B in body →
// identity is derived from jwt.tenantId (A), not body. DB query scoped to tenant A.
test('bbx-sched-identity-jwt-scope: JWT tenantId takes precedence over conflicting body tenantId', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    jwt: {
      tenantId: TENANT_A,
      workspaceId: WS_A,
      sub: 'user:a',
      roles: ['tenant-owner'],
    },
    // attacker-controlled body fields that must be ignored
    tenantId: TENANT_B,
    workspaceId: WS_B,
  });

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);

  const listQuery = pg.calls.find((c) => /SELECT \* FROM scheduled_jobs/i.test(c.sql));
  assert.ok(listQuery, 'expected a SELECT * FROM scheduled_jobs query to be executed');

  // First two params must be TENANT_A and WS_A — not the body's TENANT_B/WS_B
  assert.equal(
    listQuery.params[0],
    TENANT_A,
    `expected DB query scoped to TENANT_A, got ${listQuery.params[0]}`,
  );
  assert.equal(
    listQuery.params[1],
    WS_A,
    `expected DB query scoped to WS_A, got ${listQuery.params[1]}`,
  );
});

// bbx-sched-identity-missing-tenantid
// Scenario 3: JWT present but missing tenantId claim → HTTP 401, no DB query.
test('bbx-sched-identity-missing-tenantid: JWT without tenantId returns 401 UNAUTHENTICATED with no DB queries', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    jwt: {
      // tenantId intentionally absent
      workspaceId: WS_A,
      sub: 'user:a',
      roles: [],
    },
  });

  assert.equal(result.statusCode, 401, `expected statusCode 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHENTICATED', `expected code UNAUTHENTICATED, got ${result.body?.code}`);

  const dbQueries = pg.calls.filter(
    (c) => /scheduled_jobs/i.test(c.sql) || /scheduling_config/i.test(c.sql),
  );
  assert.equal(
    dbQueries.length,
    0,
    `expected NO scheduling DB queries, but got ${dbQueries.length}: ${JSON.stringify(dbQueries.map((c) => c.sql))}`,
  );
});

// bbx-sched-identity-missing-workspaceid
// Scenario 4: JWT present but missing workspaceId claim → HTTP 401, no DB query.
test('bbx-sched-identity-missing-workspaceid: JWT without workspaceId returns 401 UNAUTHENTICATED with no DB queries', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    jwt: {
      tenantId: TENANT_A,
      // workspaceId intentionally absent
      sub: 'user:a',
      roles: [],
    },
  });

  assert.equal(result.statusCode, 401, `expected statusCode 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHENTICATED', `expected code UNAUTHENTICATED, got ${result.body?.code}`);

  const dbQueries = pg.calls.filter(
    (c) => /scheduled_jobs/i.test(c.sql) || /scheduling_config/i.test(c.sql),
  );
  assert.equal(
    dbQueries.length,
    0,
    `expected NO scheduling DB queries, but got ${dbQueries.length}: ${JSON.stringify(dbQueries.map((c) => c.sql))}`,
  );
});

// bbx-sched-identity-tenant-scope
// Scenario 5: authenticated caller jwt.tenantId=A listing jobs → query scoped to tenant A only.
test('bbx-sched-identity-tenant-scope: authenticated caller with jwt.tenantId=A sees only tenant A jobs', async () => {
  const fakeRow = {
    id: 'job-a1',
    name: 'job-a',
    cron_expression: '* * * * *',
    target_action: 'fn:a',
    payload: {},
    status: 'active',
    next_run_at: null,
    last_triggered_at: null,
    consecutive_failure_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tenant_id: TENANT_A,
    workspace_id: WS_A,
  };
  const pg = fakePg([fakeRow]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    jwt: {
      tenantId: TENANT_A,
      workspaceId: WS_A,
      sub: 'user:a',
      roles: ['tenant-owner'],
    },
  });

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);
  assert.ok(Array.isArray(result.body?.items), 'expected items array in response');

  const listQuery = pg.calls.find((c) => /SELECT \* FROM scheduled_jobs/i.test(c.sql));
  assert.ok(listQuery, 'expected a SELECT * FROM scheduled_jobs query to be executed');

  // Verify query is scoped exclusively to TENANT_A
  assert.equal(
    listQuery.params[0],
    TENANT_A,
    `expected first query param to be TENANT_A=${TENANT_A}, got ${listQuery.params[0]}`,
  );
  assert.notEqual(
    listQuery.params[0],
    TENANT_B,
    'query must NOT be scoped to TENANT_B',
  );
  assert.equal(
    listQuery.params[1],
    WS_A,
    `expected second query param to be WS_A=${WS_A}, got ${listQuery.params[1]}`,
  );
});
