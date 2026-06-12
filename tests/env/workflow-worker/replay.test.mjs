// Real-stack determinism proof (tasks 6.1/6.2/6.3 / spec "Workflow determinism"):
// execute each contract fixture flow against a live Temporal server, fetch the recorded
// history, and feed it through the SDK WorkflowReplayer (Worker.runReplayHistory). A clean
// replay proves the PRODUCTION interpreter is deterministic given the definition-as-input
// strategy — no DeterminismViolationError for any fixture.
//
//   bash tests/env/workflow-worker/run.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { preflight, createWorker, makeClient, FIXTURES, DIST, sleep } from './_harness.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

// Fixtures whose graphs run to completion WITHOUT external input (no human-approval signal,
// no resolvable sub-flow child registration). branch-retry needs an `amount` state seed.
const RUNNABLE = [
  { file: 'minimal-3-node.json', state: {} },
  { file: 'parallel-fan-out.json', state: {} },
  { file: 'branch-retry.json', state: { amount: 5000 } },
];

const WORKFLOWS_PATH = resolve(DIST, 'workflows', 'index.js');

for (const { file, state } of RUNNABLE) {
  test(`flw-rs-replay-01: ${file} replays deterministically (no DeterminismViolationError)`, SKIP, async () => {
    const def = JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8'));
    const taskQueue = `flows-replay-${randomUUID().slice(0, 8)}`;
    const w = await createWorker(taskQueue, pf.sdk);
    const { connection, client } = await makeClient(pf.sdk);
    let history;
    try {
      const handle = await client.workflow.start('DslInterpreterWorkflow', {
        args: [{ definition: def, tenant: { tenantId: 'ten-a' }, state }],
        taskQueue,
        workflowId: `flows-replay-${randomUUID()}`,
      });
      await handle.result();
      // Proto History object (directly replayable).
      history = await handle.fetchHistory();
    } finally {
      await w.shutdown();
      await connection.close();
    }

    // Replay the recorded history against the production workflow bundle. Throws on a
    // determinism violation.
    await pf.sdk.worker.Worker.runReplayHistory(
      { workflowsPath: WORKFLOWS_PATH, replayName: `replay-${file}` },
      history,
    );
    // No throw → deterministic.
    assert.ok(true);
  });
}

test('flw-rs-replay-02: human-approval signal flow replays deterministically after an approval signal', SKIP, async () => {
  const def = JSON.parse(readFileSync(resolve(FIXTURES, 'human-approval.json'), 'utf8'));
  const taskQueue = `flows-replay-appr-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  let history;
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: def, tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-replay-appr-${randomUUID()}`,
    });
    // Let the workflow reach the approval node, then send the approval signal.
    await sleep(1500);
    await handle.signal('flowApproval', { approved: true, actor: 'role:workspace_admin', nodeId: 'review' });
    const result = await handle.result();
    assert.deepEqual(result.trace, ['review', 'publish']);
    history = await handle.fetchHistory();
  } finally {
    await w.shutdown();
    await connection.close();
  }

  await pf.sdk.worker.Worker.runReplayHistory(
    { workflowsPath: WORKFLOWS_PATH, replayName: 'replay-human-approval' },
    history,
  );
  assert.ok(true);
});
