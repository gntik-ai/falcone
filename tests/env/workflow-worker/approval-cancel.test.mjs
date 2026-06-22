// Real-stack proof (issue #678 / spec "Flow executions SHALL be cancellable …"):
// cancelling a flow execution that is parked on a TERMINAL approval node which declares a
// `timeout` MUST end the run as Cancelled — it MUST NOT be silently reinterpreted as a
// timeout and finished `Completed` with a fabricated `{approved:false, timedOut:true}`
// approval record.
//
// Root cause (fixed): `runApproval`'s timeout branch used to wrap the signal-vs-timeout race
// in `CancellationScope.cancellable(...).catch(() => isResolved() ? false : true)`. The
// `.catch` was meant to absorb only the self-inflicted cleanup cancellation of the losing
// timer, but it ALSO swallowed an EXTERNAL workflow cancellation that arrived before the race
// resolved, returning `true` (timedOut) → the run then completed normally. The fix replaces
// the hand-rolled race with Temporal's built-in `condition(predicate, timeout)`, which manages
// the timer itself and lets an external CancelledFailure propagate so the run ends Cancelled.
//
// This suite drives the PRODUCTION compiled worker (services/workflow-worker/dist) against a
// live Temporal server and self-skips when Temporal/Docker is unavailable.
//
//   bash tests/env/workflow-worker/run.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { preflight, createWorker, makeClient, sleep } from './_harness.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

// --- Flow fixtures --------------------------------------------------------------------

// Terminal approval node WITH a long timeout (the bug case): the run parks on the approval
// timer; an operator cancel must win, not be reinterpreted as a timeout.
function approvalWithTimeout(timeout = 'PT10M') {
  return {
    apiVersion: 'v1.0',
    name: 'appr-cancel',
    nodes: [{ id: 'appr', type: 'approval', timeout }],
  };
}

// Terminal approval node WITHOUT a timeout (control: the no-timeout branch already cancels).
function approvalNoTimeout() {
  return {
    apiVersion: 'v1.0',
    name: 'appr-no-timeout',
    nodes: [{ id: 'appr', type: 'approval' }],
  };
}

// Approval (with timeout) followed by a downstream task (control: cancel before the task runs).
function approvalThenTask() {
  return {
    apiVersion: 'v1.0',
    name: 'appr-then-task',
    nodes: [
      { id: 'appr', type: 'approval', timeout: 'PT10M', next: 'after' },
      { id: 'after', type: 'task', taskType: 'noop-after' },
    ],
  };
}

/**
 * Poll the flowTrace query until the run has visited the approval node (so the approval timer
 * is started inside the workflow) — then it is genuinely parked on the approval. Falls back to
 * a short sleep if the query is briefly unavailable during start.
 */
async function waitUntilParkedOnApproval(handle, nodeId = 'appr', attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const trace = await handle.query('flowTrace');
      if (Array.isArray(trace) && trace.includes(nodeId)) return;
    } catch {
      // query handler not registered yet / transient — retry
    }
    await sleep(100);
  }
  throw new Error(`workflow never reached approval node '${nodeId}'`);
}

/** True if the run's terminal Temporal status is CANCELED (the SDK enum name). */
async function isCanceled(handle) {
  const desc = await handle.describe();
  const name = desc.status?.name ?? desc.status;
  return String(name).toUpperCase().includes('CANCEL');
}

// --- Case 1: BUG / SCENARIO -----------------------------------------------------------
// Cancel of a terminal approval-with-timeout run → Cancelled, NOT a fabricated timeout.
test('flw-rs-appr-cancel-01: cancelling a terminal approval-with-timeout run ends Cancelled, not a fabricated timeout', SKIP, async () => {
  const taskQueue = `flows-appr-cancel-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: approvalWithTimeout('PT10M'), tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-appr-cancel-${randomUUID()}`,
    });

    // Ensure the run is actually parked on the approval (timer started) before cancelling.
    await waitUntilParkedOnApproval(handle);
    await handle.cancel();

    // handle.result() MUST reject with a cancellation (Temporal surfaces a WorkflowFailedError
    // whose cause is a CancelledFailure) — it MUST NOT resolve to a completed result.
    let resolvedResult;
    let rejected = false;
    try {
      resolvedResult = await handle.result();
    } catch (err) {
      rejected = true;
      // The PT10M timer NEVER fired; the failure chain must be a cancellation, not a timeout.
      const chain = `${err?.name ?? ''}:${err?.message ?? ''}:${err?.cause?.name ?? ''}:${err?.cause?.message ?? ''}`;
      assert.ok(/cancel/i.test(chain), `expected a cancellation failure, got: ${chain}`);
    }
    assert.ok(rejected, `expected handle.result() to REJECT with a cancellation, but it resolved to: ${JSON.stringify(resolvedResult)}`);

    // Authoritative terminal status: the run is CANCELED (this is what flow-executor's
    // getExecution maps to the public "Canceled"/"Cancelled" status).
    assert.ok(await isCanceled(handle), 'terminal Temporal status must be CANCELED');

    // The run did NOT complete with a fabricated approval/timeout outcome.
    assert.equal(resolvedResult, undefined, 'no completed result must be produced for a cancelled approval run');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Case 2: CONTROL — a real timeout still fires and records timedOut:true ------------
test('flw-rs-appr-cancel-02: a real approval timeout still completes with {approved:false, timedOut:true}', SKIP, async () => {
  const taskQueue = `flows-appr-timeout-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    // Short timeout so the test is fast; do NOT cancel and do NOT signal → the timer fires.
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: approvalWithTimeout('PT2S'), tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-appr-timeout-${randomUUID()}`,
    });
    const result = await handle.result();
    assert.equal(result.status, 'completed');
    // The legitimate timeout outcome is recorded verbatim. `actor` is absent because no
    // approver signalled (undefined does not survive JSON payload serialization).
    assert.equal(result.state.appr.approved, false, 'timeout records approved:false');
    assert.equal(result.state.appr.timedOut, true, 'timeout records timedOut:true');
    assert.equal(result.state.appr.actor ?? undefined, undefined, 'no approving actor on a pure timeout');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Case 3: CONTROL — the approval signal arrives and records approved -----------------
test('flw-rs-appr-cancel-03: an approval signal before timeout completes with approved:true, timedOut:false', SKIP, async () => {
  const taskQueue = `flows-appr-signal-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: approvalWithTimeout('PT10M'), tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-appr-signal-${randomUUID()}`,
    });

    // Send the flowApproval signal before the (long) timeout can fire → signal wins the race.
    await waitUntilParkedOnApproval(handle);
    await handle.signal('flowApproval', { approved: true, actor: 'ops@example.test' });

    const result = await handle.result();
    assert.equal(result.status, 'completed');
    assert.equal(result.state.appr.approved, true, 'approved signal recorded');
    assert.equal(result.state.appr.timedOut, false, 'not recorded as a timeout');
    assert.equal(result.state.appr.actor, 'ops@example.test');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Case 4: CONTROL — approval+timeout+downstream task, cancelled → Cancelled ----------
// The downstream task MUST NOT run (cancel arrives while parked on the approval upstream).
test('flw-rs-appr-cancel-04: cancelling approval-with-timeout that has a downstream task ends Cancelled, task not run', SKIP, async () => {
  const taskQueue = `flows-appr-next-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: approvalThenTask(), tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-appr-next-${randomUUID()}`,
    });

    await waitUntilParkedOnApproval(handle);
    await handle.cancel();

    let rejected = false;
    try {
      await handle.result();
    } catch {
      rejected = true;
    }
    assert.ok(rejected, 'expected the run to reject (cancelled), not complete');
    assert.ok(await isCanceled(handle), 'terminal Temporal status must be CANCELED');

    // The downstream task node was never reached: no ActivityTaskScheduled for 'after'.
    const { events } = await handle.fetchHistory();
    const scheduledAfter = events.some((e) => e.activityTaskScheduledEventAttributes?.activityId === 'after');
    assert.equal(scheduledAfter, false, 'downstream task must not be scheduled when the approval is cancelled');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Case 5: CONTROL — terminal approval WITHOUT timeout, cancelled → Cancelled ---------
test('flw-rs-appr-cancel-05: cancelling a terminal approval WITHOUT a timeout ends Cancelled', SKIP, async () => {
  const taskQueue = `flows-appr-notimeout-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: approvalNoTimeout(), tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-appr-notimeout-${randomUUID()}`,
    });

    await waitUntilParkedOnApproval(handle);
    await handle.cancel();

    let rejected = false;
    try {
      await handle.result();
    } catch {
      rejected = true;
    }
    assert.ok(rejected, 'expected the run to reject (cancelled), not complete');
    assert.ok(await isCanceled(handle), 'terminal Temporal status must be CANCELED');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});
