// Live proof for add-mcp-workflows-as-tools (#395): start a Temporal workflow and poll it to a
// status, mapping it to an MCP Task handle/status — proving the Tasks-extension lifecycle against
// a REAL Temporal server. No worker runs, so RUNNING is the expected bounded state for the proof.
import { Connection, WorkflowClient } from '@temporalio/client';

// Mirror of mapExecutionToTaskStatus / taskHandleFromExecution from
// apps/control-plane-executor/src/mcp-workflows-tools.mjs (Temporal status -> MCP Task status).
const DONE = new Set(['COMPLETED']);
const FAILED = new Set(['FAILED', 'TIMED_OUT']);
const CANCELLED = new Set(['CANCELED', 'TERMINATED']);
const mapTaskStatus = (s) =>
  DONE.has(s) ? 'completed' : FAILED.has(s) ? 'failed' : CANCELLED.has(s) ? 'cancelled' : 'working';

const addr = process.env.TEMPORAL_ADDRESS || 'temporal-dev:7233';
console.log('connecting to ' + addr);
const conn = await Connection.connect({ address: addr, connectTimeout: '20s' });
console.log('CONNECTED');
const client = new WorkflowClient({ connection: conn, namespace: 'default' });

const wid = 'mcp-task-' + process.hrtime.bigint().toString();
console.log('starting workflow id=' + wid);
let handle;
try {
  handle = await client.start('runFlowWorkflow', {
    taskQueue: 'flows',
    workflowId: wid,
    args: [{ input: { date: '2026-06-13' } }],
    workflowExecutionTimeout: '2m',
  });
} catch (e) {
  console.log('START FAIL: ' + e.name + ' / ' + e.message);
  await conn.close();
  process.exit(2);
}
console.log('STARTED taskId=' + handle.workflowId + ' runId=' + handle.firstExecutionRunId);

const desc = await handle.describe();
const status = desc.status.name;
console.log('STATUS ' + status);
console.log('MCP-TASK ' + JSON.stringify({ taskId: handle.workflowId, status: mapTaskStatus(status) }));

try { await handle.terminate('spike-cleanup'); console.log('TERMINATED (cleanup)'); } catch (e) { console.log('terminate skipped: ' + e.message); }
await conn.close();
console.log('OK');
