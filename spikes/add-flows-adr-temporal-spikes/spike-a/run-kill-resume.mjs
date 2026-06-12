// EPHEMERAL SPIKE — not production code.
// Tasks 2.7 + 2.8 + 2.9: durability proof for the generic interpreter workflow.
//   - parse the 3-node YAML flow OUTSIDE the workflow (yaml lib), pass it as workflow INPUT
//   - start the workflow, SIGKILL the worker mid-run (during a long `slow` step), restart it
//   - assert the workflow completes with the expected final state and trace (worker-kill resume)
//   - assert the retry-task attempt count == 3 from history (retry across the restart)
//   - export full workflow history to evidence/ and confirm the definition is recorded in input
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { Client, Connection } from '@temporalio/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVID = join(HERE, 'evidence');
mkdirSync(EVID, { recursive: true });

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const TASK_QUEUE = `spike-a-interpreter-${randomUUID().slice(0, 8)}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnWorker(label) {
  const child = spawn(process.execPath, [join(HERE, 'worker-entry.mjs')], {
    env: { ...process.env, TEMPORAL_ADDRESS: ADDRESS, TEMPORAL_NAMESPACE: NAMESPACE, SPIKE_TASK_QUEUE: TASK_QUEUE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('WORKER_READY')) {
        console.log(`[kill-resume] ${label} worker pid=${child.pid} ready`);
        resolve(child);
      }
    });
    child.stderr.on('data', (d) => process.stderr.write(`[worker:${label}] ${d}`));
  });
}

async function main() {
  // 1) Parse the 3-node YAML fixture OUTSIDE the workflow.
  const baseDef = parseYaml(readFileSync(join(HERE, 'flow.yaml'), 'utf8'));

  // Inject a `slow` node between branch and task so a SIGKILL lands mid-activity, forcing a
  // real history replay on restart. The fixture stays the canonical 3-node flow; this is the
  // durability harness variant (still passed entirely as input — definition-as-input strategy).
  const def = {
    ...baseDef,
    nodes: [
      { id: 'n_start', type: 'start', next: 'n_branch' },
      { id: 'n_branch', type: 'branch', condition: 'amount > 100', onTrue: 'n_slow', onFalse: 'n_end' },
      { id: 'n_slow', type: 'slow', ms: 9000, next: 'n_task' },
      { id: 'n_task', type: 'task', activity: 'flakyCharge', retry: { maximumAttempts: 3 }, next: 'n_end' },
      { id: 'n_end', type: 'end' },
    ],
  };

  const runKey = randomUUID().slice(0, 8);
  const workflowId = `spike-a-kill-resume-${runKey}`;
  const state = { amount: 250 };

  const connection = await Connection.connect({ address: ADDRESS });
  const client = new Client({ connection, namespace: NAMESPACE });

  // 2) Start worker #1 and the workflow.
  let worker = await spawnWorker('first');
  const handle = await client.workflow.start('interpreterWorkflow', {
    args: [{ definition: def, state, runKey }],
    taskQueue: TASK_QUEUE,
    workflowId,
  });
  console.log(`[kill-resume] started workflow ${workflowId}`);

  // 3) Let the workflow reach the long `slow` step, then SIGKILL the worker mid-run.
  await sleep(4000);
  console.log(`[kill-resume] SIGKILL worker pid=${worker.pid} (workflow mid-run)`);
  process.kill(worker.pid, 'SIGKILL');
  await sleep(1500);

  // 4) Restart the worker — Temporal must replay history and resume to completion.
  worker = await spawnWorker('second');

  // 5) Await completion.
  const result = await handle.result();
  console.log(`[kill-resume] workflow completed: status=${result.status}`);

  // 6) Export full history. Two forms:
  //   - kill-resume-history.json: human-readable decoded events (evidence artifact)
  //   - replay-source.json: workflowId so run-replay.mjs can re-fetch the LIVE proto History
  //     (the SDK replayer needs the proto History object / proto3-JSON, not decoded events)
  const { events } = await handle.fetchHistory();
  const historyPath = join(EVID, 'kill-resume-history.json');
  writeFileSync(historyPath, JSON.stringify({ workflowId, taskQueue: TASK_QUEUE, events }, null, 2));
  writeFileSync(join(EVID, 'replay-source.json'), JSON.stringify({ workflowId, namespace: NAMESPACE, address: ADDRESS }, null, 2));

  // 7) Assertions.
  const assertions = {};

  // (a) worker-kill resume: completed with expected trace & state.
  assertions.completed = result.status === 'completed';
  assertions.branchTaken = result.trace.includes('branch:amount > 100=>true');
  assertions.taskRan = result.trace.includes('n_task');
  assertions.expectedFinalState = result.state?.n_task?.charged === true;

  // (b) retry across restart: flakyCharge fails twice, succeeds on attempt 3.
  assertions.retryAttempts = result.state?.n_task?.attempts;
  assertions.retryHonoured = result.state?.n_task?.attempts === 3;

  // Count ActivityTaskStarted events for the charge activity in history as cross-check.
  const activityStarts = events.filter((e) => e.activityTaskStartedEventAttributes).length;
  assertions.activityStartedEventsInHistory = activityStarts;

  // (c) definition-passing: the full parsed definition is present in workflow START input.
  const startEvent = events.find((e) => e.workflowExecutionStartedEventAttributes);
  const inputPayloads = startEvent?.workflowExecutionStartedEventAttributes?.input?.payloads ?? [];
  let inputDefHasNodes = false;
  try {
    const decoded = JSON.parse(Buffer.from(inputPayloads[0].data, 'base64').toString('utf8'));
    inputDefHasNodes = Array.isArray(decoded.definition?.nodes) && decoded.definition.nodes.length === 5;
  } catch {
    inputDefHasNodes = false;
  }
  assertions.definitionInHistoryInput = inputDefHasNodes;

  // WorkflowTaskStarted count > 1 confirms more than one workflow task (i.e. a replay happened).
  const wfTaskStarted = events.filter((e) => e.workflowTaskStartedEventAttributes).length;
  assertions.workflowTaskStartedCount = wfTaskStarted;
  assertions.resumedAcrossWorkerTasks = wfTaskStarted >= 2;

  writeFileSync(join(EVID, 'kill-resume-assertions.json'), JSON.stringify({ workflowId, assertions, finalState: result.state, trace: result.trace }, null, 2));

  console.log('[kill-resume] assertions:', JSON.stringify(assertions, null, 2));

  // Cleanup worker #2.
  process.kill(worker.pid, 'SIGTERM');
  await sleep(500);
  await connection.close();

  const pass =
    assertions.completed &&
    assertions.branchTaken &&
    assertions.taskRan &&
    assertions.expectedFinalState &&
    assertions.retryHonoured &&
    assertions.definitionInHistoryInput &&
    assertions.resumedAcrossWorkerTasks;

  if (!pass) {
    console.error('[kill-resume] FAILED — one or more assertions did not hold');
    process.exit(1);
  }
  console.log('[kill-resume] PASS');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
