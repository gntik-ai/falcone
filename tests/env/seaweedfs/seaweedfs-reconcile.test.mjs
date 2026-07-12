// Real-stack slice for change add-seaweedfs-bucket-lifecycle-migration.
//
// Runs the FULL reconciliation command against a REAL SeaweedFS S3 gateway using
// the production SigV4 client. Boot the backend with tests/env/seaweedfs/run.sh,
// which exports SEAWEEDFS_S3_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY. When the
// endpoint is unavailable the suite SELF-SKIPS (the SeaweedFS image/service is not
// part of the default tests/env docker-compose yet — see add-seaweedfs-deployment).
//
// Per-tenant identity enforcement (enforceIsolationPolicies) is intentionally OFF
// here: real per-tenant SeaweedFS identities are owned by add-seaweedfs-tenant-
// identities (#433). This slice proves idempotent bucket creation + the
// compat-gated config apply + a machine-readable gap log against a live backend.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runReconcileBuckets } from '../../../packages/provisioning-orchestrator/src/commands/reconcile-buckets.mjs';
import { createSeaweedFSClient } from '../../../packages/provisioning-orchestrator/src/reconcilers/s3-rest-client.mjs';

const config = {
  endpoint: process.env.SEAWEEDFS_S3_ENDPOINT,
  accessKeyId: process.env.SEAWEEDFS_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.SEAWEEDFS_S3_SECRET_ACCESS_KEY,
  region: process.env.SEAWEEDFS_S3_REGION ?? 'us-east-1',
  version: process.env.SEAWEEDFS_VERSION ?? '4.33',
};

let reachable = false;
if (config.endpoint && config.accessKeyId && config.secretAccessKey) {
  try {
    await createSeaweedFSClient(config).listBuckets();
    reachable = true;
  } catch {
    reachable = false;
  }
}
const SKIP = 'SeaweedFS endpoint unavailable — boot tests/env/seaweedfs/run.sh';

// Fixture "workspace_buckets table" — one bucket carries declared config so the
// compatibility gate produces gap entries.
const fixtureRows = [
  {
    workspace_id: 'w-alpha',
    tenant_id: 't-alpha',
    bucket_name: 'swfs-it-alpha',
    region: 'us-east-1',
    config: {
      versioning: { Status: 'Enabled' },
      policy: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: ['arn:aws:s3:::swfs-it-alpha/*'] }] },
    },
  },
  { workspace_id: 'w-beta', tenant_id: 't-beta', bucket_name: 'swfs-it-beta', region: 'us-east-1' },
];

function sink() {
  const chunks = [];
  return { write: (c) => chunks.push(c), lines: () => chunks.join('').trimEnd().split('\n').filter(Boolean) };
}

const reconcileOnce = (client, out = sink(), gap = sink()) =>
  runReconcileBuckets({
    argv: ['--apply'],
    seaweedfsClient: client,
    config,
    loadWorkspaceBuckets: async () => fixtureRows,
    enforceIsolation: false,
    outStream: out,
    gapStream: gap,
  });

test('seaweedfs reconcile: fixture buckets exist after apply; rows unchanged; gap log machine-readable', async (t) => {
  if (!reachable) return t.skip(SKIP);
  const client = createSeaweedFSClient(config);
  const before = structuredClone(fixtureRows);
  const gap = sink();

  const { exitCode, result } = await reconcileOnce(client, sink(), gap);
  assert.equal(exitCode, 0);

  // (10.2) every fixture bucket exists on SeaweedFS
  const { Buckets } = await client.listBuckets();
  const names = Buckets.map((b) => b.Name);
  for (const row of fixtureRows) assert.ok(names.includes(row.bucket_name), `${row.bucket_name} present on SeaweedFS`);

  // (10.2) workspace_buckets rows unchanged
  assert.deepEqual(fixtureRows, before);

  // (10.2) gap log present and machine-readable (one JSON object per line)
  assert.ok(result.gapEntries.length >= 1, 'gap entries produced for the configured bucket');
  for (const line of gap.lines()) JSON.parse(line);
});

test('seaweedfs reconcile: idempotent — re-run creates nothing and yields identical gap entries', async (t) => {
  if (!reachable) return t.skip(SKIP);
  const client = createSeaweedFSClient(config);

  const run1 = await reconcileOnce(client);
  const run2 = await reconcileOnce(client);

  // (10.3) the second run created no buckets and sees them all as existing
  assert.equal(run2.result.reconciliation.created.length, 0, 'no additional create calls on re-run');
  assert.deepEqual(
    run2.result.reconciliation.existing.sort(),
    fixtureRows.map((r) => r.bucket_name).sort(),
  );
  // (10.3) identical gap log entries across runs
  assert.deepEqual(run2.result.gapEntries, run1.result.gapEntries);
});
