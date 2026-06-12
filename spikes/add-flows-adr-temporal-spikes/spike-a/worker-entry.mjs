// EPHEMERAL SPIKE — not production code.
// Standalone interpreter worker, spawned as a child process so the kill-resume test can
// SIGKILL it mid-run and restart it. Polls the spike-a task queue and runs the generic
// interpreter workflow + activities.
import { Worker, NativeConnection } from '@temporalio/worker';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as activities from './activities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const TASK_QUEUE = process.env.SPIKE_TASK_QUEUE ?? 'spike-a-interpreter';

const connection = await NativeConnection.connect({ address: ADDRESS });
const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  taskQueue: TASK_QUEUE,
  workflowsPath: join(HERE, 'workflows.mjs'),
  activities,
});

// Signal readiness so the parent knows the worker is polling.
process.on('SIGTERM', () => worker.shutdown());
console.log(`WORKER_READY pid=${process.pid} queue=${TASK_QUEUE}`);
await worker.run();
console.log('WORKER_EXITED');
