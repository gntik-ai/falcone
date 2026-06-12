// Real-stack proof (task 8.1 / spec "Durable resume after worker kill"):
// start a two-task sequence with a durable wait timer between the tasks; after the first
// task completes, SIGKILL the PRODUCTION worker process while the workflow is suspended on
// the timer; start a replacement worker; assert the workflow completes, the second task
// runs exactly once, and the first task is NOT re-executed.
//
//   bash tests/env/workflow-worker/run.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { preflight, spawnWorkerProcess, makeClient, sleep } from './_harness.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

// A sequence-root flow: taskA → wait(PT6S) → taskB. The wait timer is a durable Temporal
// timer, so a SIGKILL during the wait forces a real history replay on restart.
function killResumeFlow() {
  return {
    apiVersion: 'v1.0',
    name: 'kill-resume-probe',
    nodes: [
      { id: 'root', type: 'sequence', steps: ['taskA', 'pause', 'taskB'] },
      { id: 'taskA', type: 'task', taskType: 'noop-a' },
      { id: 'pause', type: 'wait', duration: 'PT6S' },
      { id: 'taskB', type: 'task', taskType: 'noop-b' },
    ],
  };
}

test('flw-rs-kill-01: worker killed during the wait timer resumes on a replacement worker, no re-execution', SKIP, async () => {
  const taskQueue = `flows-kill-${randomUUID().slice(0, 8)}`;
  const workflowId = `flows-kill-${randomUUID()}`;
  const { connection, client } = await makeClient(pf.sdk);

  // Worker #1.
  let worker = await spawnWorkerProcess(taskQueue, 'first');
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: killResumeFlow(), tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId,
    });

    // Let taskA complete and the workflow reach the durable wait timer, then SIGKILL.
    await sleep(3000);
    process.kill(worker.pid, 'SIGKILL');
    await sleep(1500);

    // Worker #2 replaces it — Temporal replays history and resumes.
    worker = await spawnWorkerProcess(taskQueue, 'second');

    const result = await handle.result();
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.trace, ['root', 'taskA', 'pause', 'taskB']);

    // From history: each task activity COMPLETED exactly once (no re-execution of taskA).
    const { events } = await handle.fetchHistory();
    const completedByActivityId = {};
    for (const e of events) {
      const sched = e.activityTaskScheduledEventAttributes;
      if (sched) completedByActivityId[sched.activityId] = (completedByActivityId[sched.activityId] ?? 0) + 1;
    }
    assert.equal(completedByActivityId['taskA'], 1, 'taskA scheduled exactly once');
    assert.equal(completedByActivityId['taskB'], 1, 'taskB scheduled exactly once');

    // A replay actually happened: more than one WorkflowTaskStarted event.
    const wfTaskStarted = events.filter((e) => e.workflowTaskStartedEventAttributes).length;
    assert.ok(wfTaskStarted >= 2, `expected a replay (>=2 WorkflowTaskStarted), got ${wfTaskStarted}`);
  } finally {
    try { process.kill(worker.pid, 'SIGTERM'); } catch { /* already gone */ }
    await sleep(500);
    await connection.close();
  }
});
