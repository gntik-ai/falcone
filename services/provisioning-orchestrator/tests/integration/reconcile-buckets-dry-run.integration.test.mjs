import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReconcileBuckets } from '../../src/commands/reconcile-buckets.mjs';
import { createFakeSeaweedFS } from '../reconcilers/fixtures/fake-seaweedfs.mjs';

function captureStream() {
  const chunks = [];
  return { write: (c) => chunks.push(c), text: () => chunks.join('') };
}

const config = { endpoint: 'http://seaweedfs:8333', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' };
const fixtureRows = [
  { workspace_id: 'w1', tenant_id: 't1', bucket_name: 'ws-one', region: 'us-east-1',
    config: { versioning: { Status: 'Enabled' }, policy: { Statement: [{ Principal: { AWS: ['*'] }, Action: ['s3:*'] }] } } },
  { workspace_id: 'w2', tenant_id: 't2', bucket_name: 'ws-two', region: 'us-east-1' },
];

const WRITE_OPS = ['createBucket', 'putBucketPolicy', 'putBucketLifecycleConfiguration', 'putBucketCors', 'putBucketVersioning'];

describe('reconcile-buckets CLI --dry-run', () => {
  it('makes no SeaweedFS write call, emits valid JSON, and lists every bucket in the plan', async () => {
    const fake = createFakeSeaweedFS();
    const out = captureStream();
    const gap = captureStream();
    const before = structuredClone(fixtureRows);

    const { exitCode, result } = await runReconcileBuckets({
      argv: ['--dry-run'],
      seaweedfsClient: fake.api,
      config,
      loadWorkspaceBuckets: async () => fixtureRows,
      outStream: out,
      gapStream: gap,
    });

    assert.equal(exitCode, 0);
    // Reconciliation does not mutate the canonical workspace_buckets rows (same names).
    assert.deepEqual(fixtureRows, before);

    // No write was issued to the backend (only HEAD/list reads are allowed in dry-run).
    const writeCalls = fake.calls.filter((c) => WRITE_OPS.includes(c[0]));
    assert.deepEqual(writeCalls, [], `expected no write calls, saw: ${JSON.stringify(writeCalls)}`);
    assert.deepEqual(fake.bucketNames(), [], 'no bucket created on the backend');

    // Output is valid JSON.
    const parsed = JSON.parse(out.text());
    assert.equal(parsed.mode, 'dry-run');
    assert.deepEqual(parsed, result);

    // Every expected bucket name appears in the planned actions.
    const planned = parsed.plannedActions.filter((a) => a.type === 'create-bucket').map((a) => a.bucketName).sort();
    assert.deepEqual(planned, ['ws-one', 'ws-two']);
    // The policy config for ws-one is in the plan (PARTIAL → still planned, with a gap entry).
    assert.ok(parsed.gapEntries.some((e) => e.bucketName === 'ws-one' && e.configType === 'policy'));
    assert.ok(parsed.plannedActions.some((a) => a.type === 'put-bucket-policy'));
  });

  it('surfaces name-collision conflicts in the dry-run output without issuing any write', async () => {
    const fake = createFakeSeaweedFS();
    const out = captureStream();
    const collidingRows = [
      { workspace_id: 'w1', tenant_id: 't1', bucket_name: 'Acme_Data' },
      { workspace_id: 'w2', tenant_id: 't2', bucket_name: 'acme-data' },
      { workspace_id: 'w3', tenant_id: 't3', bucket_name: 'unique-one' },
    ];

    const { exitCode, result } = await runReconcileBuckets({
      argv: ['--dry-run'],
      seaweedfsClient: fake.api,
      config,
      loadWorkspaceBuckets: async () => collidingRows,
      outStream: out,
      gapStream: captureStream(),
    });

    assert.equal(exitCode, 0);
    // Conflict for the colliding pair is reported, identifying both workspaces.
    assert.equal(result.reconciliation.conflicts.length, 1);
    assert.equal(result.reconciliation.conflicts[0].bucketName, 'acme-data');
    assert.deepEqual(result.reconciliation.conflicts[0].workspaceIds.sort(), ['w1', 'w2']);
    // Only the non-conflicting bucket is planned; the colliding pair is not.
    const planned = result.plannedActions.filter((a) => a.type === 'create-bucket').map((a) => a.bucketName);
    assert.deepEqual(planned, ['unique-one']);
    // No write of any kind was issued.
    assert.deepEqual(fake.calls.filter((c) => WRITE_OPS.includes(c[0])), []);
  });
});
