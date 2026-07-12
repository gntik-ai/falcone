import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileBucket,
  detectNameCollisions,
  reconcileAllBuckets,
} from '../../src/reconcilers/bucket-reconciler.mjs';
import { createFakeSeaweedFS } from './fixtures/fake-seaweedfs.mjs';

describe('reconcileBucket (HEAD-then-create)', () => {
  it('creates a missing bucket', async () => {
    const fake = createFakeSeaweedFS();
    const out = await reconcileBucket('new-bucket', fake.api);
    assert.deepEqual(out, { bucketName: 'new-bucket', action: 'created' });
    assert.equal(fake.countCalls('createBucket'), 1);
  });

  it('no-ops an existing bucket', async () => {
    const fake = createFakeSeaweedFS({ buckets: ['existing'] });
    const out = await reconcileBucket('existing', fake.api);
    assert.deepEqual(out, { bucketName: 'existing', action: 'exists' });
    assert.equal(fake.countCalls('createBucket'), 0);
  });

  it('dry-run never creates', async () => {
    const fake = createFakeSeaweedFS();
    const out = await reconcileBucket('planned', fake.api, { dryRun: true });
    assert.equal(out.action, 'would_create');
    assert.equal(fake.countCalls('createBucket'), 0);
  });

  it('rejects an invalid name before any backend call', async () => {
    const fake = createFakeSeaweedFS();
    await assert.rejects(() => reconcileBucket('Bad_Name', fake.api), /INVALID_BUCKET_NAME|Invalid bucket/);
    assert.equal(fake.calls.length, 0);
  });

  it('propagates a non-404 head error instead of masking it as create', async () => {
    const client = {
      headBucket: async () => { const e = new Error('ServiceUnavailable'); e.statusCode = 503; throw e; },
      createBucket: async () => { throw new Error('should not be called'); },
    };
    await assert.rejects(() => reconcileBucket('abc', client), /ServiceUnavailable/);
  });
});

describe('detectNameCollisions', () => {
  it('groups workspaces whose names sanitize to the same bucket', () => {
    const rows = [
      { workspace_id: 'w1', bucket_name: 'Acme_Data' },
      { workspace_id: 'w2', bucket_name: 'acme-data' },
      { workspace_id: 'w3', bucket_name: 'unique-bucket' },
    ];
    const collisions = detectNameCollisions(rows);
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].bucketName, 'acme-data');
    assert.deepEqual(collisions[0].workspaceIds.sort(), ['w1', 'w2']);
  });

  it('returns nothing when all names are unique', () => {
    const rows = [
      { workspace_id: 'w1', bucket_name: 'a-bucket' },
      { workspace_id: 'w2', bucket_name: 'b-bucket' },
    ];
    assert.deepEqual(detectNameCollisions(rows), []);
  });
});

describe('reconcileAllBuckets', () => {
  const rows = [
    { workspace_id: 'w1', tenant_id: 't1', bucket_name: 'ws-one' },
    { workspace_id: 'w2', tenant_id: 't2', bucket_name: 'ws-two' },
  ];

  it('is idempotent: re-running yields the same bucket set and no new creates', async () => {
    const fake = createFakeSeaweedFS();

    const run1 = await reconcileAllBuckets(rows, fake.api);
    assert.deepEqual(run1.created.sort(), ['ws-one', 'ws-two']);
    assert.equal(fake.countCalls('createBucket'), 2);
    const afterFirst = fake.bucketNames();

    const run2 = await reconcileAllBuckets(rows, fake.api);
    // Same backend set, second run created nothing (all 'exists').
    assert.deepEqual(fake.bucketNames(), afterFirst);
    assert.equal(fake.countCalls('createBucket'), 2, 'no additional creates on re-run');
    assert.equal(run2.created.length, 0);
    assert.deepEqual(run2.existing.sort(), ['ws-one', 'ws-two']);
    assert.deepEqual(run2.outcomes.map((o) => o.action), ['exists', 'exists']);
  });

  it('skips colliding pairs and reports them, while non-conflicting buckets proceed', async () => {
    const fake = createFakeSeaweedFS();
    const collidingRows = [
      { workspace_id: 'w1', tenant_id: 't1', bucket_name: 'Acme_Data' },
      { workspace_id: 'w2', tenant_id: 't2', bucket_name: 'acme-data' },
      { workspace_id: 'w3', tenant_id: 't3', bucket_name: 'lonely-bucket' },
    ];
    const res = await reconcileAllBuckets(collidingRows, fake.api);

    assert.equal(res.conflicts.length, 1);
    assert.equal(res.conflicts[0].bucketName, 'acme-data');
    assert.deepEqual(res.conflicts[0].workspaceIds.sort(), ['w1', 'w2']);
    // Only the unique bucket is created; neither colliding bucket is.
    assert.deepEqual(fake.bucketNames(), ['lonely-bucket']);
    assert.equal(fake.calls.some((c) => c[0] === 'createBucket' && c[1] === 'acme-data'), false);
  });
});
