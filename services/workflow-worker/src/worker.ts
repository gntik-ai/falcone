/**
 * Worker runtime entry point.
 *
 * Connects to the Temporal frontend, registers DslInterpreterWorkflow + the harness
 * activities on the configured task queue/namespace, and runs until SIGTERM. Connection
 * config is read from the environment per the tenancy ADR (#356):
 *
 *   TEMPORAL_ADDRESS    Temporal frontend gRPC address      (default 127.0.0.1:7233)
 *   TEMPORAL_NAMESPACE  Temporal namespace                  (default falcone-flows)
 *   TEMPORAL_TASK_QUEUE Task queue to poll                  (default flows-main)
 *   WORKER_HEALTH_PORT  HTTP health-probe port for K8s      (default 8080)
 *
 * Graceful shutdown: on SIGTERM/SIGINT the worker stops accepting new tasks, drains the
 * current poll, and exits 0 within terminationGracePeriodSeconds.
 */
import { Worker, NativeConnection } from '@temporalio/worker';
import { createServer, type Server } from 'node:http';
import * as activities from './activities';

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'falcone-flows';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'flows-main';
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? '8080');

/**
 * Minimal HTTP health endpoint for Kubernetes liveness/readiness probes. The worker has
 * no inbound business traffic; this server exists ONLY for probes.
 */
function startHealthServer(getState: () => { ready: boolean }): Server {
  const server = createServer((req, res) => {
    const { ready } = getState();
    if (req.url === '/livez') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/readyz') {
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ready' : 'starting' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(HEALTH_PORT);
  return server;
}

async function run(): Promise<void> {
  const state = { ready: false };
  const health = startHealthServer(() => state);

  const connection = await NativeConnection.connect({ address: ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    // The SDK bundles the workflow module (CJS) into the deterministic isolate at startup.
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  // Graceful shutdown: drain in-flight polls, then exit 0.
  const shutdown = () => {
    state.ready = false;
    worker.shutdown();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  state.ready = true;
  // eslint-disable-next-line no-console
  console.log(`workflow-worker READY namespace=${NAMESPACE} taskQueue=${TASK_QUEUE} address=${ADDRESS}`);
  try {
    await worker.run();
  } finally {
    await connection.close();
    health.close();
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error('workflow-worker FAILED', err);
    process.exit(1);
  },
);
