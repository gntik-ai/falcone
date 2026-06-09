// Black-box test suite for change fix-scheduling-enforce-cron-floor.
// Drives the PUBLIC action entrypoint (`main`) only — fake pg injected via params.
//
// Tests:
//   bbx-cron-floor-01: POST with cron below min_interval_seconds floor → 422 CRON_BELOW_FLOOR, no INSERT
//   bbx-cron-floor-02: PATCH with cron below min_interval_seconds floor → 422 CRON_BELOW_FLOOR, no UPDATE
//   bbx-cron-floor-03: POST with cron at/above floor → NOT 422 CRON_BELOW_FLOOR (floor check passes)
import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../services/scheduling-engine/actions/scheduling-management.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'wsaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const JOB_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Config row returned for workspace-scoped getConfig query.
// min_interval_seconds=3600 means only cron expressions that fire at most every
// 3600s (hourly or slower) are allowed.
const CONFIG_ROW = {
  tenant_id: TENANT_A,
  workspace_id: WS_A,
  scheduling_enabled: true,
  max_active_jobs: 100,
  min_interval_seconds: 3600,
  max_consecutive_failures: 5,
};

// Existing job row returned for PATCH SELECT query.
const EXISTING_JOB_ROW = {
  id: JOB_ID,
  tenant_id: TENANT_A,
  workspace_id: WS_A,
  name: 'test-job',
  cron_expression: '0 * * * *',
  target_action: 'fn:test',
  payload: {},
  status: 'active',
  consecutive_failure_count: 0,
  max_consecutive_failures: 5,
  next_run_at: null,
  last_triggered_at: null,
  created_by: 'user:a',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
};

// Builds a fake pg whose query() inspects the SQL and returns appropriate rows:
//   - scheduling_configurations WHERE tenant_id=... AND workspace_id=... → CONFIG_ROW
//   - scheduling_configurations WHERE tenant_id=... AND workspace_id IS NULL → empty
//   - scheduled_jobs WHERE id=... (SELECT for PATCH current-row lookup) → jobRow
//   - scheduled_jobs COUNT(*) (getActiveJobCount) → { count: 0 }
//   - Everything else → empty rows
function fakePg(jobRow = EXISTING_JOB_ROW) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      // Config queries from getConfig()
      if (/scheduling_configurations/i.test(sql)) {
        // Workspace-specific query (has workspace_id = $2 positional param, not IS NULL)
        if (/workspace_id\s*=\s*\$2/i.test(sql)) {
          return { rows: [CONFIG_ROW] };
        }
        // Tenant-level fallback (workspace_id IS NULL)
        return { rows: [] };
      }
      // getActiveJobCount: COUNT(*) from scheduled_jobs
      if (/COUNT\(\*\)/i.test(sql) && /scheduled_jobs/i.test(sql)) {
        return { rows: [{ count: 0 }] };
      }
      // PATCH: SELECT current job row
      if (/SELECT \* FROM scheduled_jobs WHERE id = \$1/i.test(sql)) {
        return { rows: jobRow ? [jobRow] : [] };
      }
      return { rows: [] };
    },
  };
}

function baseHeaders() {
  return {
    'x-tenant-id': TENANT_A,
    'x-workspace-id': WS_A,
    'x-auth-subject': 'user:a',
    'x-actor-roles': 'tenant-owner',
  };
}

// bbx-cron-floor-01: POST with minute-granularity cron (60s interval) below floor of 3600s
// must return 422 CRON_BELOW_FLOOR without touching scheduled_jobs.
test('bbx-cron-floor-01: POST cron below floor returns 422 CRON_BELOW_FLOOR without INSERT', async () => {
  const pg = fakePg();
  const result = await main({
    pg,
    method: 'POST',
    path: '/v1/scheduling/jobs',
    body: {
      cronExpression: '* * * * *',
      name: 'fast-job',
      targetAction: 'fn:fast',
      payload: {},
    },
    __ow_headers: baseHeaders(),
  });

  assert.equal(result.statusCode, 422, `expected 422, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(result.body?.code, 'CRON_BELOW_FLOOR', `expected code CRON_BELOW_FLOOR, got ${result.body?.code}`);

  const insertCalls = pg.calls.filter((c) => /INSERT INTO scheduled_jobs/i.test(c.sql));
  assert.equal(
    insertCalls.length,
    0,
    `expected NO INSERT INTO scheduled_jobs, but got ${insertCalls.length}: ${JSON.stringify(insertCalls.map((c) => c.sql))}`,
  );
});

// bbx-cron-floor-02: PATCH with minute-granularity cron below floor of 3600s
// must return 422 CRON_BELOW_FLOOR without running the UPDATE query.
test('bbx-cron-floor-02: PATCH cron below floor returns 422 CRON_BELOW_FLOOR without UPDATE', async () => {
  const pg = fakePg(EXISTING_JOB_ROW);
  const result = await main({
    pg,
    method: 'PATCH',
    path: `/v1/scheduling/jobs/${JOB_ID}`,
    body: {
      cronExpression: '* * * * *',
    },
    __ow_headers: baseHeaders(),
  });

  assert.equal(result.statusCode, 422, `expected 422, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(result.body?.code, 'CRON_BELOW_FLOOR', `expected code CRON_BELOW_FLOOR, got ${result.body?.code}`);

  const updateCalls = pg.calls.filter((c) => /UPDATE scheduled_jobs/i.test(c.sql));
  assert.equal(
    updateCalls.length,
    0,
    `expected NO UPDATE scheduled_jobs, but got ${updateCalls.length}: ${JSON.stringify(updateCalls.map((c) => c.sql))}`,
  );
});

// bbx-cron-floor-03: POST with hourly cron (0 * * * * = 3600s interval, exactly at floor)
// must NOT return 422 CRON_BELOW_FLOOR. It may fail for other reasons (e.g. target action
// validation or fake-pg limitations) but the floor check must pass.
test('bbx-cron-floor-03: POST cron at floor (0 * * * *) does NOT return 422 CRON_BELOW_FLOOR', async () => {
  const pg = fakePg();
  const result = await main({
    pg,
    method: 'POST',
    path: '/v1/scheduling/jobs',
    body: {
      cronExpression: '0 * * * *',
      name: 'hourly-job',
      targetAction: 'fn:hourly',
      payload: {},
    },
    __ow_headers: baseHeaders(),
  });

  // Must NOT be 422 CRON_BELOW_FLOOR
  const isCronFloorError = result.statusCode === 422 && result.body?.code === 'CRON_BELOW_FLOOR';
  assert.equal(
    isCronFloorError,
    false,
    `expected floor check to PASS for 0 * * * *, but got 422 CRON_BELOW_FLOOR`,
  );
});
