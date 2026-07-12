// Real-stack proof: the PRODUCTION DslInterpreterWorkflow executes a sequence of task
// nodes in declaration order against a live Temporal server, using the minimal-3-node
// contract fixture as input (packages/internal-contracts/src/fixtures/flows).
//
//   bash tests/env/workflow-worker/run.sh
//
// Self-skips if Temporal/Docker is unavailable or the worker dist/ is not built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { preflight, createWorker, makeClient, FIXTURES } from './_harness.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

test('flw-rs-seq-01: minimal-3-node fixture runs all three tasks in declaration order', SKIP, async () => {
  const def = JSON.parse(readFileSync(resolve(FIXTURES, 'minimal-3-node.json'), 'utf8'));
  const taskQueue = `flows-seq-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: def, tenant: { tenantId: 'ten-a', flowId: 'minimal', flowVersion: 'v1.0' } }],
      taskQueue,
      workflowId: `flows-seq-${randomUUID()}`,
    });
    const result = await handle.result();
    assert.equal(result.status, 'completed');
    // Declaration order from the fixture: step-1 → step-2 → step-3.
    assert.deepEqual(result.trace, ['step-1', 'step-2', 'step-3']);
    // Pinned version is carried through.
    assert.equal(result.flowVersion, 'v1.0');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

test('flw-rs-seq-02: per-task retryPolicy from branch-retry fixture is applied (activity scheduled with mapped RetryPolicy)', SKIP, async () => {
  const def = JSON.parse(readFileSync(resolve(FIXTURES, 'branch-retry.json'), 'utf8'));
  const taskQueue = `flows-retry-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    // amount > 1000 → first arm → high-value-task (retryPolicy maxAttempts:5, initialInterval:PT2S).
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [
        {
          definition: def,
          tenant: { tenantId: 'ten-a', flowId: 'branch-retry', flowVersion: 'v1.0' },
          state: { amount: 5000 },
        },
      ],
      taskQueue,
      workflowId: `flows-retry-${randomUUID()}`,
    });
    const result = await handle.result();
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.trace, ['decide', 'high-value-task']);

    // Assert the RetryPolicy was applied verbatim to the TASK activity (activityId =
    // the node id 'high-value-task'), NOT the branch's evaluateExpression activity.
    const { events } = await handle.fetchHistory();
    const scheduled = events
      .filter((e) => e.activityTaskScheduledEventAttributes)
      .map((e) => e.activityTaskScheduledEventAttributes);
    const taskScheduled = scheduled.find((a) => a.activityId === 'high-value-task');
    assert.ok(taskScheduled, `expected an ActivityTaskScheduled with activityId 'high-value-task', got: ${scheduled.map((a) => a.activityId).join(', ')}`);
    const retry = taskScheduled.retryPolicy;
    assert.ok(retry, 'the task ActivityTaskScheduled must carry a RetryPolicy');
    assert.equal(retry.maximumAttempts, 5, 'maxAttempts:5 → maximumAttempts:5');
    // nonRetryableErrors → nonRetryableErrorTypes
    assert.deepEqual(retry.nonRetryableErrorTypes, ['ValidationError']);
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

test('flw-rs-seq-03: task with no retryPolicy gets the SDK default (no custom maximumAttempts)', SKIP, async () => {
  const def = JSON.parse(readFileSync(resolve(FIXTURES, 'minimal-3-node.json'), 'utf8'));
  const taskQueue = `flows-nodef-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: def, tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-nodef-${randomUUID()}`,
    });
    await handle.result();
    const { events } = await handle.fetchHistory();
    const scheduled = events.find((e) => e.activityTaskScheduledEventAttributes);
    const retry = scheduled?.activityTaskScheduledEventAttributes?.retryPolicy;
    // SDK default policy has maximumAttempts 0 (unlimited) — the interpreter did NOT pin a custom value.
    assert.ok(!retry || retry.maximumAttempts === 0 || retry.maximumAttempts === undefined,
      `expected SDK default retry (no custom maximumAttempts), got ${JSON.stringify(retry)}`);
  } finally {
    await w.shutdown();
    await connection.close();
  }
});
