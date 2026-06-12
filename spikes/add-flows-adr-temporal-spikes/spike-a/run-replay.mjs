// EPHEMERAL SPIKE — not production code.
// Task 2.9: replay determinism. Re-fetch the LIVE proto History of the kill-resume run from
// Temporal and feed it through the SDK replayer (Worker.runReplayHistory). The replayer accepts
// the proto `History` object that the client returns. A clean replay proves the interpreter
// workflow is deterministic given the definition-as-input strategy: the definition recorded in
// history reproduces the exact same command sequence with no NonDeterminismError — and is
// reproducible regardless of which worker (here: none, just the replayer) picks it up.
import { Worker } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVID = join(HERE, 'evidence');

async function main() {
  const { workflowId, namespace, address } = JSON.parse(
    readFileSync(join(EVID, 'replay-source.json'), 'utf8'),
  );

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  const handle = client.workflow.getHandle(workflowId);
  // Proto History object (NOT decoded JSON) — directly replayable.
  const history = await handle.fetchHistory();
  await connection.close();

  const result = { timestamp: new Date().toISOString(), workflowId, replay: {} };
  try {
    await Worker.runReplayHistory(
      {
        workflowsPath: join(HERE, 'workflows.mjs'),
        replayName: 'spike-a-replay',
      },
      history,
    );
    result.replay = { deterministic: true, nonDeterminismError: null };
    console.log('[replay] PASS — history replayed with no non-determinism error');
  } catch (err) {
    result.replay = { deterministic: false, nonDeterminismError: String(err?.message ?? err) };
    console.error('[replay] FAILED —', err?.message ?? err);
  }

  writeFileSync(join(EVID, 'replay-result.json'), JSON.stringify(result, null, 2));
  if (!result.replay.deterministic) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
