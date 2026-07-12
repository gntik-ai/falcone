// Black-box test suite for change fix-scheduling-runner-idempotent-claim.
// Drives the PUBLIC action entrypoint (`main`) only — fake pg injected via params.
//
// Tests: bbx-runner-idempotency-01 through -03
import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../packages/scheduling-engine/actions/scheduling-job-runner.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'wsaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const JOB_ID = 'job-00000000-0000-0000-0000-000000000001';
const EXEC_ID = 'exec-00000000-0000-0000-0000-000000000001';

const fakeJobRow = {
  id: JOB_ID,
  tenant_id: TENANT_A,
  workspace_id: WS_A,
  status: 'active',
  deleted_at: null,
  target_action: 'fn:my-action',
  payload: { key: 'value' },
  consecutive_failure_count: 0,
  updated_at: new Date().toISOString(),
};

const fakeExecutionRow = {
  id: EXEC_ID,
  job_id: JOB_ID,
  started_at: new Date().toISOString(),
  status: 'running',
  finished_at: null,
  duration_ms: null,
  error_summary: null,
};

// Stateful fake pg that models the compare-and-set claim:
// - First UPDATE ... WHERE id = $1 AND started_at IS NULL → returns the row (claimed)
// - Subsequent UPDATE ... WHERE id = $1 AND started_at IS NULL → returns [] (already claimed)
// The `calls` array captures every pg.query() invocation for assertion.
function makeStatefulPg() {
  let claimed = false;
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });

      // Job SELECT
      if (/SELECT \* FROM scheduled_jobs WHERE id = \$1/.test(sql)) {
        return { rows: [fakeJobRow] };
      }

      // Atomic claim UPDATE — the key compare-and-set
      if (/UPDATE scheduled_executions SET started_at = \$2 WHERE id = \$1 AND started_at IS NULL RETURNING \*/.test(sql)) {
        if (!claimed) {
          claimed = true;
          return { rows: [{ ...fakeExecutionRow, started_at: params[1] }] };
        }
        return { rows: [] };
      }

      // Finalize execution UPDATE
      if (/UPDATE scheduled_executions SET status/.test(sql)) {
        return { rows: [] };
      }

      // Job failure/success count UPDATE
      if (/UPDATE scheduled_jobs SET consecutive_failure_count/.test(sql) || /UPDATE scheduled_jobs SET consecutive_failure_count = 0/.test(sql)) {
        return { rows: [] };
      }

      // Catch-all for any other UPDATE/INSERT on scheduled_jobs
      if (/UPDATE scheduled_jobs/.test(sql)) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

function makeInvokeAction() {
  let callCount = 0;
  const fn = async ({ targetAction, payload, correlationId }) => {
    callCount++;
    return { ok: true };
  };
  fn.callCount = () => callCount;
  return fn;
}

function baseParams(pg, invokeAction) {
  return {
    pg,
    jobId: JOB_ID,
    executionId: EXEC_ID,
    correlationId: 'corr-test-001',
    invokeAction,
  };
}

// bbx-runner-idempotency-01
// First invocation claims the execution and calls invokeAction once.
// Verifies normal execution path returns an outcome (not skipped).
test('bbx-runner-idempotency-01: first invocation claims execution and calls invokeAction exactly once', async () => {
  const pg = makeStatefulPg();
  const invokeAction = makeInvokeAction();

  const result = await main(baseParams(pg, invokeAction));

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);
  assert.ok(!result.body?.skipped, `expected NOT skipped on first invocation, got skipped=${result.body?.skipped}`);
  assert.ok(result.body?.outcome, `expected body.outcome to be present, got ${JSON.stringify(result.body)}`);
  assert.equal(invokeAction.callCount(), 1, `expected invokeAction called exactly once, got ${invokeAction.callCount()}`);
});

// bbx-runner-idempotency-02
// Second invocation with same executionId (pg already claimed) → skipped:already_claimed,
// invokeAction call count stays at 1 (no second call), and no finalize UPDATEs occur.
test('bbx-runner-idempotency-02: second invocation returns skipped:already_claimed and does NOT call invokeAction again', async () => {
  const pg = makeStatefulPg();
  const invokeAction = makeInvokeAction();
  const params = baseParams(pg, invokeAction);

  // First invocation — normal run
  const first = await main(params);
  assert.equal(first.statusCode, 200, `first: expected 200, got ${first.statusCode}`);
  assert.ok(!first.body?.skipped, `first: expected NOT skipped`);
  const invokeCountAfterFirst = invokeAction.callCount();
  assert.equal(invokeCountAfterFirst, 1, `first: expected invokeAction called once, got ${invokeCountAfterFirst}`);

  // Capture how many pg calls happened during first invocation
  const pgCallsAfterFirst = pg.calls.length;

  // Second invocation — same executionId, pg.claimed is true now
  const second = await main(params);

  assert.equal(second.statusCode, 200, `second: expected statusCode 200, got ${second.statusCode}`);
  assert.equal(second.body?.skipped, true, `second: expected body.skipped===true, got ${second.body?.skipped}`);
  assert.equal(second.body?.reason, 'already_claimed', `second: expected reason 'already_claimed', got ${second.body?.reason}`);

  // invokeAction must NOT have been called again
  assert.equal(invokeAction.callCount(), 1, `second: expected invokeAction still 1 total call, got ${invokeAction.callCount()}`);

  // Verify no finalize UPDATEs (scheduled_executions SET status) on second run
  const allCalls = pg.calls;
  const callsDuringSecond = allCalls.slice(pgCallsAfterFirst);
  const finalizeCallsDuringSecond = callsDuringSecond.filter(
    (c) => /UPDATE scheduled_executions SET status/.test(c.sql),
  );
  assert.equal(
    finalizeCallsDuringSecond.length,
    0,
    `second: expected NO finalize UPDATEs, but got ${finalizeCallsDuringSecond.length}: ${JSON.stringify(finalizeCallsDuringSecond.map((c) => c.sql))}`,
  );

  // Also verify no scheduled_jobs UPDATE on second run
  const jobUpdateCallsDuringSecond = callsDuringSecond.filter(
    (c) => /UPDATE scheduled_jobs/.test(c.sql),
  );
  assert.equal(
    jobUpdateCallsDuringSecond.length,
    0,
    `second: expected NO scheduled_jobs UPDATEs, but got ${jobUpdateCallsDuringSecond.length}`,
  );
});

// bbx-runner-idempotency-03
// Execution is already claimed before the very first call to this runner instance
// (simulate a separate runner having already claimed it).
// pg returns [] on the very first claim attempt → skipped:already_claimed, invokeAction not called.
test('bbx-runner-idempotency-03: execution pre-claimed externally → first call returns skipped:already_claimed, invokeAction not called', async () => {
  // Make pg that reports already-claimed from the start
  const calls = [];
  const pg = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });

      if (/SELECT \* FROM scheduled_jobs WHERE id = \$1/.test(sql)) {
        return { rows: [fakeJobRow] };
      }

      // The atomic claim returns nothing (already claimed by another runner)
      if (/UPDATE scheduled_executions SET started_at = \$2 WHERE id = \$1 AND started_at IS NULL RETURNING \*/.test(sql)) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const invokeAction = makeInvokeAction();

  const result = await main(baseParams(pg, invokeAction));

  assert.equal(result.statusCode, 200, `expected statusCode 200, got ${result.statusCode}`);
  assert.equal(result.body?.skipped, true, `expected body.skipped===true, got ${result.body?.skipped}`);
  assert.equal(result.body?.reason, 'already_claimed', `expected reason 'already_claimed', got ${result.body?.reason}`);
  assert.equal(invokeAction.callCount(), 0, `expected invokeAction NOT called, got ${invokeAction.callCount()}`);

  // No finalize or job-update writes should have occurred
  const finalizeOrJobWrites = calls.filter(
    (c) => /UPDATE scheduled_executions SET status/.test(c.sql) || /UPDATE scheduled_jobs/.test(c.sql),
  );
  assert.equal(
    finalizeOrJobWrites.length,
    0,
    `expected no finalize/job writes, got ${finalizeOrJobWrites.length}: ${JSON.stringify(finalizeOrJobWrites.map((c) => c.sql))}`,
  );
});
