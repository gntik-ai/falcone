// EPHEMERAL SPIKE — not production code.
// One spike-b worker process. Spawned once per namespace (namespace-per-tenant model) or once
// for the whole pool (shared-namespace model). Polls a task queue with a known poller config so
// the orchestrator can compute pollers-per-tenant, and holds gRPC connection(s) to 7233 whose
// count the orchestrator reads from /proc/<pid>/net/tcp.
import { Worker, NativeConnection } from '@temporalio/worker';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const TASK_QUEUE = process.env.SPIKE_TASK_QUEUE ?? 'spike-b';
const WF_POLLERS = Number(process.env.SPIKE_WF_POLLERS ?? '2');
const ACT_POLLERS = Number(process.env.SPIKE_ACT_POLLERS ?? '2');

const connection = await NativeConnection.connect({ address: ADDRESS });
const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  taskQueue: TASK_QUEUE,
  workflowsPath: join(HERE, 'workflows.mjs'),
  maxConcurrentWorkflowTaskPolls: WF_POLLERS,
  maxConcurrentActivityTaskPolls: ACT_POLLERS,
});

process.on('SIGTERM', () => worker.shutdown());
// Emit the poller config so the orchestrator records it deterministically.
console.log(
  JSON.stringify({
    event: 'WORKER_READY',
    pid: process.pid,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowPollers: WF_POLLERS,
    activityPollers: ACT_POLLERS,
  }),
);
await worker.run();
console.log(JSON.stringify({ event: 'WORKER_EXITED', pid: process.pid }));
