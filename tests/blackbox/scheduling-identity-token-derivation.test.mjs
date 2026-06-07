// Black-box test suite for change configure-apisix-scheduling-claim-forwarding
// (supersedes the params.jwt contract introduced by derive-scheduling-identity-from-token).
//
// Drives the PUBLIC action entrypoint (`main`) only — fake pg injected via params.
// Identity is derived exclusively from the trusted identity headers the API gateway
// injects from the verified token (X-Tenant-Id / X-Workspace-Id / X-Auth-Subject /
// X-Actor-Roles), read by the action as lowercase keys on params.__ow_headers. The
// action never reads identity from caller-supplied body/query fields, and fails
// closed (HTTP 401) when the trusted tenant/workspace headers are absent.
//
// Gateway-layer scenarios (401 issued AT the gateway, stripping of client-supplied
// X-* headers) are NOT exercisable through the action's public interface and are
// covered by real-stack E2E instead; these tests assert the action-side contract
// and defense-in-depth.
//
// Tests: bbx-sched-identity-no-headers, bbx-sched-identity-header-scope,
//        bbx-sched-identity-missing-tenant, bbx-sched-identity-missing-workspace,
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

// Trusted identity headers as the gateway delivers them (OpenWhisk lowercases header keys).
// Pass an override value of `undefined` to OMIT that header (simulating an absent claim).
function identityHeaders(overrides = {}) {
  const h = {
    'x-tenant-id': TENANT_A,
    'x-workspace-id': WS_A,
    'x-auth-subject': 'user:a',
    'x-actor-roles': 'tenant-owner',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete h[key];
    else h[key] = value;
  }
  return h;
}

const schedulingDbQueries = (pg) =>
  pg.calls.filter((c) => /scheduled_jobs/i.test(c.sql) || /scheduling_config/i.test(c.sql));

// bbx-sched-identity-no-headers
// No trusted identity headers, even with attacker-controlled body fields -> HTTP 401
// UNAUTHENTICATED, and no scheduling DB operation runs.
test('bbx-sched-identity-no-headers: body tenantId/workspaceId without trusted identity headers returns 401 with no DB queries', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    __ow_headers: {}, // gateway injected nothing -> unauthenticated
    // attacker-controlled body fields that must NEVER be used as identity
    tenantId: TENANT_A,
    workspaceId: WS_A,
  });

  assert.equal(result.statusCode, 401, `expected statusCode 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHENTICATED', `expected code UNAUTHENTICATED, got ${result.body?.code}`);
  assert.equal(
    schedulingDbQueries(pg).length,
    0,
    `expected NO scheduling DB queries, got ${schedulingDbQueries(pg).length}`,
  );
});

// bbx-sched-identity-header-scope
// Trusted X-Tenant-Id header (A) is authoritative; a conflicting body tenantId (B) is ignored.
test('bbx-sched-identity-header-scope: trusted X-Tenant-Id header takes precedence over conflicting body tenantId', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    __ow_headers: identityHeaders({ tenantId: TENANT_A, workspaceId: WS_A }),
    // attacker-controlled body fields that must be ignored
    tenantId: TENANT_B,
    workspaceId: WS_B,
  });

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);
  const listQuery = pg.calls.find((c) => /SELECT \* FROM scheduled_jobs/i.test(c.sql));
  assert.ok(listQuery, 'expected a SELECT * FROM scheduled_jobs query to be executed');
  assert.equal(listQuery.params[0], TENANT_A, `expected DB query scoped to TENANT_A, got ${listQuery.params[0]}`);
  assert.equal(listQuery.params[1], WS_A, `expected DB query scoped to WS_A, got ${listQuery.params[1]}`);
});

// bbx-sched-identity-missing-tenant
// X-Tenant-Id header absent -> HTTP 401, no DB query.
test('bbx-sched-identity-missing-tenant: absent X-Tenant-Id header returns 401 with no DB queries', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    __ow_headers: identityHeaders({ 'x-tenant-id': undefined }),
  });

  assert.equal(result.statusCode, 401, `expected statusCode 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHENTICATED', `expected code UNAUTHENTICATED, got ${result.body?.code}`);
  assert.equal(schedulingDbQueries(pg).length, 0, `expected NO scheduling DB queries, got ${schedulingDbQueries(pg).length}`);
});

// bbx-sched-identity-missing-workspace
// X-Workspace-Id header absent -> HTTP 401, no DB query.
test('bbx-sched-identity-missing-workspace: absent X-Workspace-Id header returns 401 with no DB queries', async () => {
  const pg = fakePg([]);
  const result = await main({
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query: {},
    __ow_headers: identityHeaders({ 'x-workspace-id': undefined }),
  });

  assert.equal(result.statusCode, 401, `expected statusCode 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHENTICATED', `expected code UNAUTHENTICATED, got ${result.body?.code}`);
  assert.equal(schedulingDbQueries(pg).length, 0, `expected NO scheduling DB queries, got ${schedulingDbQueries(pg).length}`);
});

// bbx-sched-identity-tenant-scope
// Authenticated caller with X-Tenant-Id=A lists jobs -> query scoped to tenant A only.
test('bbx-sched-identity-tenant-scope: authenticated caller with X-Tenant-Id=A sees only tenant A jobs', async () => {
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
    __ow_headers: identityHeaders({ tenantId: TENANT_A, workspaceId: WS_A }),
  });

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);
  assert.ok(Array.isArray(result.body?.items), 'expected items array in response');
  const listQuery = pg.calls.find((c) => /SELECT \* FROM scheduled_jobs/i.test(c.sql));
  assert.ok(listQuery, 'expected a SELECT * FROM scheduled_jobs query to be executed');
  assert.equal(listQuery.params[0], TENANT_A, `expected first query param TENANT_A, got ${listQuery.params[0]}`);
  assert.notEqual(listQuery.params[0], TENANT_B, 'query must NOT be scoped to TENANT_B');
  assert.equal(listQuery.params[1], WS_A, `expected second query param WS_A, got ${listQuery.params[1]}`);
});
