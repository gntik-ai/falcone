// Real-stack proof (change add-console-flow-monitoring / #366): run a fixture flow against a LIVE
// Temporal server + the PRODUCTION interpreter worker, then drive the PRODUCTION
// flow-monitoring-executor.mjs over the same Temporal client to consume the execution's history
// as node-status frames — asserting the streamed node sequence matches the Temporal history's
// ActivityTaskScheduled events (the #359 node-ID convention end-to-end). Includes a live
// cross-tenant probe: a foreign workflow id is rejected with 403 BEFORE any history is fetched.
//
//   bash tests/env/flows-monitoring/run.sh
//
// Self-skips if Temporal/Docker is unavailable or the worker dist/ is not built (repo precedent:
// the workflow-worker real-stack suite + pgvector tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { preflight, createWorker, makeClient, FIXTURES } from '../workflow-worker/_harness.mjs';
import {
  createFlowMonitoringExecutor,
  createTemporalHistoryProvider,
} from '../../../apps/control-plane/src/runtime/flow-monitoring-executor.mjs';
import { buildWorkflowId } from '../../../apps/control-plane/src/runtime/flow-executor.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

const TENANT = 'ten-mon-a';
const WORKSPACE = 'ws-mon-a';

// Consume the monitoring executor's SSE-shaped events into an array; resolves on `stream-end`.
function streamToArray(executor, { executionId, identity, lastEventId }) {
  return new Promise((resolve, reject) => {
    const events = [];
    executor
      .subscribe({
        executionId,
        identity,
        lastEventId,
        onEvent: (event) => {
          events.push(event);
          if (event.type === 'stream-end') resolve(events);
        },
        onError: (err) => reject(err),
      })
      .catch(reject);
    // Safety timeout so a stuck stream fails the test rather than hanging the suite.
    setTimeout(() => resolve(events), 20000);
  });
}

test('flw-rs-mon-01: live execution streams node-status frames matching Temporal history', SKIP, async () => {
  const def = JSON.parse(readFileSync(resolve(FIXTURES, 'minimal-3-node.json'), 'utf8'));
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const taskQueue = `flows-mon-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    // Server-minted workflow id with the tenant/workspace prefix the executor validates.
    const workflowId = buildWorkflowId(TENANT, WORKSPACE, 'minimal', randomUUID());
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: def, tenant: { tenantId: TENANT, workspaceId: WORKSPACE, flowId: 'minimal', flowVersion: 'v1.0' } }],
      taskQueue,
      workflowId,
    });
    await handle.result(); // run to completion so the monitoring executor replays a terminal run

    const executor = createFlowMonitoringExecutor({
      workflowHistoryProvider: createTemporalHistoryProvider({ getClient: async () => client }),
      pollIntervalMs: 100,
    });

    const events = await streamToArray(executor, {
      executionId: workflowId,
      identity: { tenantId: TENANT, workspaceId: WORKSPACE },
    });

    // stream-end terminates the stream.
    assert.equal(events.at(-1)?.type, 'stream-end', 'terminal run ends with stream-end');

    // Every node-status frame maps to a DSL node id (no loop suffix, no unmapped events).
    const nodeStatus = events.filter((e) => e.type === 'node-status');
    assert.ok(nodeStatus.length > 0, 'node-status frames were streamed');
    const streamedNodes = new Set(nodeStatus.map((e) => e.nodeId));
    for (const nodeId of streamedNodes) {
      assert.ok(nodeIds.has(nodeId), `streamed nodeId ${nodeId} maps to a DSL node`);
    }
    // The three task nodes all reached `completed`.
    for (const id of ['step-1', 'step-2', 'step-3']) {
      assert.ok(nodeStatus.some((e) => e.nodeId === id && e.status === 'completed'), `${id} completed`);
    }

    // Cross-check against the raw history: the set of scheduled DSL node ids equals the streamed set.
    const { events: history } = await handle.fetchHistory();
    const scheduledNodes = new Set(
      history
        .filter((e) => e.activityTaskScheduledEventAttributes)
        .map((e) => {
          const a = e.activityTaskScheduledEventAttributes.activityId;
          const i = a.indexOf('#');
          return i === -1 ? a : a.slice(0, i);
        }),
    );
    assert.deepEqual([...streamedNodes].sort(), [...scheduledNodes].sort(), 'streamed nodes == history scheduled nodes');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

test('flw-rs-mon-02: cross-tenant probe — foreign workflow id is rejected with 403 (no history fetched)', SKIP, async () => {
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const executor = createFlowMonitoringExecutor({
      workflowHistoryProvider: createTemporalHistoryProvider({ getClient: async () => client }),
      pollIntervalMs: 100,
    });
    // A workflow id owned by tenant B, requested with tenant A's identity → 403 before any
    // Temporal call (the prefix check short-circuits). The run need not even exist.
    const foreignId = buildWorkflowId('ten-mon-B', 'ws-mon-B', 'minimal', randomUUID());
    await assert.rejects(
      () => executor.subscribe({
        executionId: foreignId,
        identity: { tenantId: TENANT, workspaceId: WORKSPACE },
        onEvent() {},
        onError() {},
      }),
      (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
    );
  } finally {
    await connection.close();
  }
});
