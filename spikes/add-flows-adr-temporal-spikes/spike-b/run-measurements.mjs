// EPHEMERAL SPIKE — not production code.
// Spike B orchestrator. Measures the two tenancy models at N = {1, 5, 20} tenants:
//   - namespace-per-tenant: register N namespaces, spawn one worker per namespace, count
//     pollers (N x per-worker pollers) and gRPC connections to 7233 (per worker PID, summed).
//   - shared-namespace + tenantId search attribute: one worker pool; start workflows for
//     multiple tenants tagged with `tenantId`; run a visibility query filtered by tenantId
//     against the PostgreSQL visibility store and assert ONLY that tenant's runs return.
// Writes raw JSON to evidence; the markdown reports are derived from it.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';
import { countGrpcConnections } from './conn-count.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'evidence');
mkdirSync(OUT, { recursive: true });

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const WF_POLLERS = 2;
const ACT_POLLERS = 2;
const POLLERS_PER_WORKER = WF_POLLERS + ACT_POLLERS;
const N_VALUES = [1, 5, 20];
const RUN = randomUUID().slice(0, 6);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnWorker({ namespace, taskQueue }) {
  const child = spawn(process.execPath, [join(HERE, 'worker-entry.mjs')], {
    env: {
      ...process.env,
      TEMPORAL_ADDRESS: ADDRESS,
      TEMPORAL_NAMESPACE: namespace,
      SPIKE_TASK_QUEUE: taskQueue,
      SPIKE_WF_POLLERS: String(WF_POLLERS),
      SPIKE_ACT_POLLERS: String(ACT_POLLERS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const line = buf.split('\n').find((l) => l.includes('WORKER_READY'));
      if (line) resolve(child);
    });
    child.stderr.on('data', () => {});
  });
}

async function ensureNamespace(client, namespace) {
  try {
    await client.workflowService.registerNamespace({
      namespace,
      workflowExecutionRetentionPeriod: { seconds: 60 * 60 * 24 },
    });
  } catch (err) {
    // AlreadyExists is fine for idempotent re-runs.
    if (!String(err?.message ?? err).includes('AlreadyExists') && err?.code !== 6) throw err;
  }
}

// ------------------------------- namespace-per-tenant ------------------------------------
async function measureNamespacePerTenant(client, n) {
  const namespaces = [];
  for (let i = 0; i < n; i++) namespaces.push(`tenant-${RUN}-${i}`);

  for (const ns of namespaces) await ensureNamespace(client, ns);
  // Namespaces propagate to the namespace registry asynchronously.
  await sleep(2000);

  const workers = [];
  for (const ns of namespaces) {
    const w = await spawnWorker({ namespace: ns, taskQueue: `tq-${ns}` });
    workers.push({ ns, child: w });
  }
  // Let pollers establish their long-poll gRPC streams.
  await sleep(3000);

  let totalConnections = 0;
  const perWorker = [];
  for (const w of workers) {
    const conns = countGrpcConnections(w.child.pid);
    perWorker.push({ namespace: w.ns, pid: w.child.pid, grpcConnections: conns, pollers: POLLERS_PER_WORKER });
    totalConnections += conns;
  }

  // Teardown workers.
  for (const w of workers) {
    try {
      w.child.kill('SIGTERM');
    } catch {}
  }
  await sleep(1000);

  return {
    model: 'namespace-per-tenant',
    n,
    workerProcesses: workers.length,
    pollersTotal: workers.length * POLLERS_PER_WORKER,
    pollersPerTenant: POLLERS_PER_WORKER,
    grpcConnectionsTotal: totalConnections,
    grpcConnectionsPerTenant: workers.length ? totalConnections / workers.length : 0,
    perWorker,
  };
}

// ------------------------------- shared-namespace ----------------------------------------
async function ensureTenantIdSearchAttr(client, namespace) {
  try {
    await client.operatorService.addSearchAttributes({
      namespace,
      searchAttributes: { tenantId: 6 /* Keyword */ },
    });
  } catch (err) {
    if (!String(err?.message ?? err).toLowerCase().includes('already')) {
      // Non-fatal: attribute may already exist from the docker setup step.
    }
  }
}

async function measureSharedNamespace(client, n) {
  const namespace = 'default';
  const taskQueue = `shared-tq-${RUN}`;
  await ensureTenantIdSearchAttr(client, namespace);
  await sleep(1000);

  // Single worker pool regardless of N.
  const worker = await spawnWorker({ namespace, taskQueue });
  await sleep(3000);
  const grpc = countGrpcConnections(worker.pid);

  // Start one workflow per tenant, tagged with the tenantId search attribute.
  const tenantIds = [];
  for (let i = 0; i < n; i++) tenantIds.push(`stenant-${RUN}-${i}`);

  const sharedClient = new Client({ connection: client.connection, namespace });
  for (const tid of tenantIds) {
    const handle = await sharedClient.workflow.start('tenantPing', {
      args: [{ tenantId: tid }],
      taskQueue,
      workflowId: `shared-${tid}-${randomUUID().slice(0, 6)}`,
      typedSearchAttributes: undefined,
      searchAttributes: { tenantId: [tid] },
    });
    await handle.result();
  }
  // Visibility (Postgres SQL) indexes asynchronously after close.
  await sleep(4000);

  // Visibility assertion: query for ONE tenant, assert only its run(s) appear (probe >=2 tenants).
  let visibility = { probedTenants: Math.min(n, 2), isolated: null, details: [] };
  if (n >= 2) {
    visibility.isolated = true;
    for (const tid of tenantIds.slice(0, 2)) {
      const got = [];
      for await (const wf of sharedClient.workflow.list({ query: `tenantId = '${tid}'` })) {
        got.push(wf.workflowId);
      }
      // Cross-tenant leak check: none of the OTHER tenants' workflowIds should appear.
      const others = tenantIds.filter((t) => t !== tid);
      const leaked = got.some((wid) => others.some((o) => wid.includes(`shared-${o}-`)));
      const ok = got.length >= 1 && !leaked;
      visibility.details.push({ query: `tenantId = '${tid}'`, returnedCount: got.length, leaked, ok });
      if (!ok) visibility.isolated = false;
    }
  } else {
    visibility.details.push({ note: 'N<2: cross-tenant probe requires >=2 tenants; skipped at this N' });
  }

  try {
    worker.kill('SIGTERM');
  } catch {}
  await sleep(1000);

  return {
    model: 'shared-namespace',
    n,
    workerProcesses: 1,
    pollersTotal: POLLERS_PER_WORKER,
    pollersPerTenant: 0,
    grpcConnectionsTotal: grpc,
    grpcConnectionsPerTenant: 0,
    visibility,
  };
}

async function main() {
  const connection = await Connection.connect({ address: ADDRESS });
  const client = new Client({ connection });

  const results = { timestamp: new Date().toISOString(), address: ADDRESS, run: RUN, namespacePerTenant: [], sharedNamespace: [] };

  for (const n of N_VALUES) {
    console.log(`[spike-b] namespace-per-tenant N=${n} ...`);
    const r1 = await measureNamespacePerTenant(client, n);
    results.namespacePerTenant.push(r1);
    console.log(`  pollersTotal=${r1.pollersTotal} grpcConnectionsTotal=${r1.grpcConnectionsTotal}`);
  }

  for (const n of N_VALUES) {
    console.log(`[spike-b] shared-namespace N=${n} ...`);
    const r2 = await measureSharedNamespace(client, n);
    results.sharedNamespace.push(r2);
    const v = r2.visibility?.isolated;
    console.log(`  pollersTotal=${r2.pollersTotal} grpcConnectionsTotal=${r2.grpcConnectionsTotal} visibilityIsolated=${v}`);
  }

  await connection.close();
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2));
  console.log(`[spike-b] wrote ${join(OUT, 'measurements.json')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
