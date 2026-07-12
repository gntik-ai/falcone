// Shared real-stack harness for the workflow-worker proof.
//
// Drives the PRODUCTION interpreter (apps/workflow-worker/dist) against a live
// Temporal server (tests/env docker-compose `temporal` service). Self-skips when
// Temporal/Docker is unavailable (repo precedent: pgvector real-stack tests).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..', '..');
export const SVC = resolve(ROOT, 'services', 'workflow-worker');
export const DIST = resolve(SVC, 'dist');
export const FIXTURES = resolve(ROOT, 'services', 'internal-contracts', 'src', 'fixtures', 'flows');

export const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
export const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';

const require = createRequire(import.meta.url);

/** Resolve the Temporal client/worker SDK from the worker's own node_modules. */
export function loadSdk() {
  return {
    client: require(resolve(SVC, 'node_modules', '@temporalio', 'client')),
    worker: require(resolve(SVC, 'node_modules', '@temporalio', 'worker')),
  };
}

/** Is the compiled worker present AND a Temporal server reachable? */
export async function preflight() {
  if (!existsSync(resolve(DIST, 'worker.js')) || !existsSync(resolve(DIST, 'workflows', 'index.js'))) {
    return { ok: false, reason: 'workflow-worker dist/ not built (run pnpm --filter @in-falcone/workflow-worker build)' };
  }
  let sdk;
  try {
    sdk = loadSdk();
  } catch (err) {
    return { ok: false, reason: `Temporal SDK not installed: ${err?.message ?? err}` };
  }
  try {
    const connection = await sdk.client.Connection.connect({ address: ADDRESS, connectTimeout: '3s' });
    await connection.close();
    return { ok: true, sdk };
  } catch (err) {
    return { ok: false, reason: `Temporal server not reachable at ${ADDRESS}: ${err?.message ?? err}` };
  }
}

/** Create an in-process Temporal Worker bound to the production workflow bundle. */
export async function createWorker(taskQueue, sdk = loadSdk()) {
  const connection = await sdk.worker.NativeConnection.connect({ address: ADDRESS });
  const activities = require(resolve(DIST, 'activities', 'index.js'));
  const worker = await sdk.worker.Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue,
    workflowsPath: resolve(DIST, 'workflows', 'index.js'),
    activities,
  });
  const runPromise = worker.run();
  return {
    worker,
    async shutdown() {
      worker.shutdown();
      await runPromise.catch(() => {});
      await connection.close();
    },
  };
}

/**
 * Spawn the PRODUCTION worker entrypoint (dist/worker.js) as a child process so a test
 * can SIGKILL it mid-run. Resolves when the worker logs READY.
 */
export function spawnWorkerProcess(taskQueue, label = 'worker') {
  const child = spawn(process.execPath, [resolve(DIST, 'worker.js')], {
    env: {
      ...process.env,
      TEMPORAL_ADDRESS: ADDRESS,
      TEMPORAL_NAMESPACE: NAMESPACE,
      TEMPORAL_TASK_QUEUE: taskQueue,
      // Avoid port clashes between sequential worker processes.
      WORKER_HEALTH_PORT: String(18080 + Math.floor(Math.random() * 1000)),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolveReady) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('READY')) resolveReady(child);
    });
    child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  });
}

export function makeClient(sdk = loadSdk()) {
  return sdk.client.Connection.connect({ address: ADDRESS }).then(
    (connection) => ({ connection, client: new sdk.client.Client({ connection, namespace: NAMESPACE }) }),
  );
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
