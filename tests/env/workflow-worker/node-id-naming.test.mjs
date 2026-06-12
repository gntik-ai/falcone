// Real-stack proof (task 7 / spec "Stable node-ID activity naming convention"):
// execute a flow against a live Temporal server, export the history, and assert that
// EVERY ActivityTaskScheduled event carries an activityId that maps back to a DSL node
// id from the originating definition — no unmapped events.
//
//   bash tests/env/workflow-worker/run.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { preflight, createWorker, makeClient, FIXTURES, SVC } from './_harness.mjs';

const require = createRequire(import.meta.url);
const { nodeIdFromActivityId } = require(resolve(SVC, 'dist', 'shared', 'naming.js'));

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };

test('flw-rs-nodeid-01: every ActivityTaskScheduled activityId maps to a DSL node id', SKIP, async () => {
  const def = JSON.parse(readFileSync(resolve(FIXTURES, 'minimal-3-node.json'), 'utf8'));
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const taskQueue = `flows-nodeid-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [{ definition: def, tenant: { tenantId: 'ten-a' } }],
      taskQueue,
      workflowId: `flows-nodeid-${randomUUID()}`,
    });
    await handle.result();

    const { events } = await handle.fetchHistory();
    const scheduled = events.filter((e) => e.activityTaskScheduledEventAttributes);
    assert.equal(scheduled.length, 3, 'three task nodes → three ActivityTaskScheduled events');

    const unmapped = [];
    const seen = [];
    for (const e of scheduled) {
      const activityId = e.activityTaskScheduledEventAttributes.activityId;
      const nodeId = nodeIdFromActivityId(activityId);
      seen.push(nodeId);
      if (!nodeIds.has(nodeId)) unmapped.push(activityId);
    }
    assert.deepEqual(unmapped, [], `every activityId must map to a DSL node id; unmapped: ${unmapped.join(', ')}`);
    // The three node ids are exactly the fixture's task node ids.
    assert.deepEqual(seen.sort(), ['step-1', 'step-2', 'step-3']);
  } finally {
    await w.shutdown();
    await connection.close();
  }
});
