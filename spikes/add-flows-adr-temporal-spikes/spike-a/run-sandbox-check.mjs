// EPHEMERAL SPIKE — not production code.
// Task 2.4 / 2.5: run cel-js AND jsonata INSIDE the Temporal workflow V8 sandbox and record
// whether each survives bundling + the deterministic isolate. Also measures the workflow
// bundle size impact of each engine. Writes machine-readable results to evidence/.
import { Worker, NativeConnection, bundleWorkflowCode } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { writeFileSync, mkdirSync, statSync, writeFileSync as wf, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as activities from './activities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVID = join(HERE, 'evidence');
mkdirSync(EVID, { recursive: true });

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
const TASK_QUEUE = 'spike-a-sandbox-check';

async function measureBundle() {
  // Bundle the whole workflow module (imports both cel-js and jsonata) to measure the
  // combined bundle and confirm both engines are bundlable for the workflow isolate.
  const { code } = await bundleWorkflowCode({
    workflowsPath: join(HERE, 'workflows.mjs'),
  });
  // The bundle is a multi-MB regenerable build artifact — write it to a temp path purely to
  // measure its byte size, then delete it (we keep only the measurement in sandbox-check.json,
  // not the binary, so no >1MB file is committed).
  const tmpBundle = join(tmpdir(), `flows-spike-workflow-bundle-${process.pid}.js`);
  wf(tmpBundle, code);
  const bytes = statSync(tmpBundle).size;
  rmSync(tmpBundle, { force: true });
  return { note: 'bundle measured then discarded (regenerable build artifact)', bytes };
}

async function main() {
  const result = {
    timestamp: new Date().toISOString(),
    address: ADDRESS,
    namespace: NAMESPACE,
    sdkVersion: process.env.npm_package_dependencies__temporalio_worker ?? 'see package.json',
    probes: {},
    bundle: {},
  };

  result.bundle = await measureBundle();

  const connection = await Connection.connect({ address: ADDRESS });
  const client = new Client({ connection, namespace: NAMESPACE });

  const workerConnection = await NativeConnection.connect({ address: ADDRESS });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: join(HERE, 'workflows.mjs'),
    activities,
  });

  const runPromise = worker.run();

  for (const wfName of ['celProbe', 'jsonataProbe']) {
    const engine = wfName === 'celProbe' ? 'cel-js' : 'jsonata';
    try {
      const handle = await client.workflow.start(wfName, {
        args: [{ amount: 250 }],
        taskQueue: TASK_QUEUE,
        workflowId: `${wfName}-${randomUUID()}`,
      });
      const out = await handle.result();
      result.probes[engine] = { survivedSandbox: true, evaluatedTo: out, expected: true };
      console.log(`[sandbox] ${engine}: survived, amount>100 => ${out}`);
    } catch (err) {
      result.probes[engine] = { survivedSandbox: false, error: String(err?.message ?? err) };
      console.log(`[sandbox] ${engine}: FAILED — ${err?.message ?? err}`);
    }
  }

  worker.shutdown();
  await runPromise.catch(() => {});
  await workerConnection.close();
  await connection.close();

  writeFileSync(join(EVID, 'sandbox-check.json'), JSON.stringify(result, null, 2));
  console.log(`\n[sandbox] bundle: ${(result.bundle.bytes / 1024).toFixed(1)} kB`);
  console.log(`[sandbox] wrote ${join(EVID, 'sandbox-check.json')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
