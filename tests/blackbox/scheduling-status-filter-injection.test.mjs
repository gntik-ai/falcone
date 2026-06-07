// Black-box test suite for change parameterize-scheduling-status-filter.
// Drives the PUBLIC action entrypoint (`main`) only — fake pg injected via params.
//
// Tests: bbx-sched-status-injection-01, -02, valid-status, absent-status, unknown-status
import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../services/scheduling-engine/actions/scheduling-management.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'wsaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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

function baseParams(pg, query = {}) {
  return {
    pg,
    method: 'GET',
    path: '/v1/scheduling/jobs',
    query,
    // Identity is delivered by the gateway as trusted claim headers (lowercased
    // by OpenWhisk); see change configure-apisix-scheduling-claim-forwarding.
    __ow_headers: {
      'x-tenant-id': TENANT_A,
      'x-workspace-id': WS_A,
      'x-auth-subject': 'user:a',
      'x-actor-roles': 'tenant-owner',
    },
  };
}

// bbx-sched-status-injection-01
// Classic OR injection — must be rejected before any scheduled_jobs query runs.
test('bbx-sched-status-injection-01: OR injection payload returns 400 INVALID_STATUS without querying scheduled_jobs', async () => {
  const pg = fakePg([]);
  const result = await main(baseParams(pg, { status: "active' OR '1'='1" }));

  assert.equal(result.statusCode, 400, `expected statusCode 400, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'INVALID_STATUS', `expected code INVALID_STATUS, got ${result.body?.code}`);

  const scheduledJobsQueries = pg.calls.filter((c) => /scheduled_jobs/i.test(c.sql));
  assert.equal(
    scheduledJobsQueries.length,
    0,
    `expected NO scheduled_jobs query to run, but got ${scheduledJobsQueries.length}: ${JSON.stringify(scheduledJobsQueries.map((c) => c.sql))}`,
  );
});

// bbx-sched-status-injection-02
// UNION injection payload — must be rejected before any scheduled_jobs query runs.
test('bbx-sched-status-injection-02: UNION injection payload returns 400 INVALID_STATUS without querying scheduled_jobs', async () => {
  const pg = fakePg([]);
  const result = await main(
    baseParams(pg, { status: "x' UNION SELECT id,null,null,null FROM scheduled_jobs--" }),
  );

  assert.equal(result.statusCode, 400, `expected statusCode 400, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'INVALID_STATUS', `expected code INVALID_STATUS, got ${result.body?.code}`);

  const scheduledJobsQueries = pg.calls.filter((c) => /scheduled_jobs/i.test(c.sql));
  assert.equal(
    scheduledJobsQueries.length,
    0,
    `expected NO scheduled_jobs query to run, but got ${scheduledJobsQueries.length}`,
  );
});

// bbx-sched-status-valid: valid status 'active' results in parameterized $4 query
test('bbx-sched-status-valid: valid status active returns 200 with parameterized query', async () => {
  const fakeRow = {
    id: 'job-1',
    name: 'test',
    cron_expression: '* * * * *',
    target_action: 'fn:test',
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
  const result = await main(baseParams(pg, { status: 'active' }));

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);

  // Find the SELECT on scheduled_jobs
  const listQuery = pg.calls.find((c) => /SELECT \* FROM scheduled_jobs/i.test(c.sql));
  assert.ok(listQuery, 'expected a SELECT * FROM scheduled_jobs query to be executed');

  // SQL must use $4 placeholder, NOT inline the literal string 'active'
  assert.ok(
    /status\s*=\s*\$4/.test(listQuery.sql),
    `expected 'status = $4' in SQL, got: ${listQuery.sql}`,
  );
  assert.ok(
    !/'active'/.test(listQuery.sql),
    `SQL must NOT contain the literal string 'active' inlined, got: ${listQuery.sql}`,
  );

  // Params array must be [TENANT_A, WS_A, 100, 'active']
  assert.deepEqual(
    listQuery.params,
    [TENANT_A, WS_A, 100, 'active'],
    `expected params [TENANT_A, WS_A, 100, 'active'], got ${JSON.stringify(listQuery.params)}`,
  );
});

// bbx-sched-status-absent: omitted status filter — no status predicate, 3-param query
test('bbx-sched-status-absent: absent status filter returns 200 with no status predicate', async () => {
  const pg = fakePg([]);
  const result = await main(baseParams(pg, {}));

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);

  const listQuery = pg.calls.find((c) => /SELECT \* FROM scheduled_jobs/i.test(c.sql));
  assert.ok(listQuery, 'expected a SELECT * FROM scheduled_jobs query to be executed');

  // SQL must NOT contain any status = predicate
  assert.ok(
    !/status\s*=/.test(listQuery.sql),
    `SQL must NOT contain a status predicate when status is absent, got: ${listQuery.sql}`,
  );

  // Params array must be [TENANT_A, WS_A, 100]
  assert.deepEqual(
    listQuery.params,
    [TENANT_A, WS_A, 100],
    `expected params [TENANT_A, WS_A, 100], got ${JSON.stringify(listQuery.params)}`,
  );
});

// bbx-sched-status-unknown: unrecognized status value must be rejected
test('bbx-sched-status-unknown: unknown status value returns 400 INVALID_STATUS without querying scheduled_jobs', async () => {
  const pg = fakePg([]);
  const result = await main(baseParams(pg, { status: 'unknown' }));

  assert.equal(result.statusCode, 400, `expected statusCode 400, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'INVALID_STATUS', `expected code INVALID_STATUS, got ${result.body?.code}`);

  const scheduledJobsQueries = pg.calls.filter((c) => /scheduled_jobs/i.test(c.sql));
  assert.equal(
    scheduledJobsQueries.length,
    0,
    `expected NO scheduled_jobs query to run, but got ${scheduledJobsQueries.length}`,
  );
});
