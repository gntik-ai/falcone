// Real-stack proof (task 8.2 / spec "Execution version pinning"):
// start a flow execution with definition v1 (a two-task graph behind a durable wait);
// publish v2 of the "same" flow (a DIFFERENT node graph) while v1 is in-flight; assert the
// in-flight execution completes on v1 semantics — the v2 publish never alters it.
//
// The interpreter pins the definition passed as workflow INPUT for the life of the run
// (the inline definition is immutable and recorded in history), so a later publish cannot
// reach the running closure.
//
//   bash tests/env/workflow-worker/run.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { preflight, createWorker, makeClient, sleep } from './_harness.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

// v1: root sequence taskA → wait(PT5S) → taskB-v1.
function flowV1() {
  return {
    apiVersion: 'v1.0',
    name: 'pinned-flow',
    nodes: [
      { id: 'root', type: 'sequence', steps: ['taskA', 'pause', 'taskB-v1'] },
      { id: 'taskA', type: 'task', taskType: 'noop-a' },
      { id: 'pause', type: 'wait', duration: 'PT5S' },
      { id: 'taskB-v1', type: 'task', taskType: 'noop-b-v1' },
    ],
  };
}

// v2: a STRUCTURALLY DIFFERENT graph for the "same" flow name (different node ids).
function flowV2() {
  return {
    apiVersion: 'v1.0',
    name: 'pinned-flow',
    nodes: [
      { id: 'root', type: 'sequence', steps: ['taskX-v2', 'taskY-v2'] },
      { id: 'taskX-v2', type: 'task', taskType: 'noop-x-v2' },
      { id: 'taskY-v2', type: 'task', taskType: 'noop-y-v2' },
    ],
  };
}

test('flw-rs-pin-01: a v2 publish during an in-flight v1 run does not change the v1 execution', SKIP, async () => {
  const taskQueue = `flows-pin-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const v1 = flowV1();
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: v1, tenant: { tenantId: 'ten-a', flowId: 'pinned-flow', flowVersion: 'v1' } }],
      taskQueue,
      workflowId: `flows-pin-${randomUUID()}`,
    });

    // While v1 is suspended on its durable wait, "publish" v2: mutate the shared object AND
    // start a separate v2 run. Neither must reach the in-flight v1 closure.
    await sleep(1500);
    // Mutate the original object reference — proves the run does not re-read it.
    v1.nodes = flowV2().nodes;
    const v2Handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: flowV2(), tenant: { tenantId: 'ten-a', flowId: 'pinned-flow', flowVersion: 'v2' } }],
      taskQueue,
      workflowId: `flows-pin-v2-${randomUUID()}`,
    });

    const [r1, r2] = await Promise.all([handle.result(), v2Handle.result()]);

    // The in-flight run completed on v1 semantics (v1 node graph), NOT v2.
    assert.deepEqual(r1.trace, ['root', 'taskA', 'pause', 'taskB-v1'], 'in-flight run pinned to v1 graph');
    assert.equal(r1.flowVersion, 'v1');

    // The separate v2 run completed on v2 semantics.
    assert.deepEqual(r2.trace, ['root', 'taskX-v2', 'taskY-v2']);
    assert.equal(r2.flowVersion, 'v2');

    // The v1 run's history input still records the ORIGINAL v1 graph (immutable pin).
    const { events } = await handle.fetchHistory();
    const start = events.find((e) => e.workflowExecutionStartedEventAttributes);
    const payload = start.workflowExecutionStartedEventAttributes.input.payloads[0];
    const decoded = JSON.parse(Buffer.from(payload.data).toString('utf8'));
    const recordedNodeIds = decoded.definition.nodes.map((n) => n.id);
    assert.ok(recordedNodeIds.includes('taskB-v1'), 'history input retains the v1 node graph');
    assert.ok(!recordedNodeIds.includes('taskX-v2'), 'history input was NOT mutated to v2');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});
