import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  discoverS3Buckets,
  mergeDiscoveredBuckets,
  insertMissingWorkspaceBucketRows,
} from '../../src/reconcilers/bucket-discovery.mjs';

const rows = [
  { workspace_id: 'w1', tenant_id: 't1', bucket_name: 'ws-w1-assets', region: 'us-east-1' },
  { workspace_id: 'w2', tenant_id: 't2', bucket_name: 'ws-w2-assets', region: 'us-east-1' },
];

describe('discoverS3Buckets', () => {
  it('normalizes the AWS-SDK ListBuckets shape', async () => {
    const client = { listBuckets: async () => ({ Buckets: [{ Name: 'a' }, { Name: 'b' }] }) };
    assert.deepEqual(await discoverS3Buckets(client), ['a', 'b']);
  });
  it('accepts a plain array of names', async () => {
    const client = { listBuckets: async () => ['x', 'y'] };
    assert.deepEqual(await discoverS3Buckets(client), ['x', 'y']);
  });
  it('throws without a listBuckets-capable client', async () => {
    await assert.rejects(() => discoverS3Buckets({}), /listBuckets/);
  });
});

describe('mergeDiscoveredBuckets', () => {
  it('all discovered buckets have rows → no missing', () => {
    const { existing, missing } = mergeDiscoveredBuckets(['ws-w1-assets', 'ws-w2-assets'], rows);
    assert.equal(existing.length, 2);
    assert.equal(missing.length, 0);
  });

  it('some discovered buckets have no row → reported as missing', () => {
    const { existing, missing } = mergeDiscoveredBuckets(['ws-w1-assets', 'orphan-bucket'], rows);
    assert.deepEqual(existing.map((e) => e.bucketName), ['ws-w1-assets']);
    assert.deepEqual(missing.map((m) => m.bucketName), ['orphan-bucket']);
  });

  it('no discovered buckets have rows → all missing', () => {
    const { existing, missing } = mergeDiscoveredBuckets(['o1', 'o2'], []);
    assert.equal(existing.length, 0);
    assert.deepEqual(missing.map((m) => m.bucketName), ['o1', 'o2']);
  });
});

describe('insertMissingWorkspaceBucketRows', () => {
  it('inserts a row per associable bucket and skips the rest', async () => {
    const queries = [];
    const pool = { query: async (sql, params) => { queries.push({ sql, params }); } };
    const associate = (name) => (name === 'acme-legacy' ? { workspaceId: 'wX', tenantId: 'acme' } : null);

    const { inserted, skipped } = await insertMissingWorkspaceBucketRows(
      [{ bucketName: 'acme-legacy' }, { bucketName: 'unknown-bucket' }],
      { pool, associate },
    );

    assert.deepEqual(inserted, [{ bucketName: 'acme-legacy', workspaceId: 'wX', tenantId: 'acme', region: 'us-east-1' }]);
    assert.deepEqual(skipped, [{ bucketName: 'unknown-bucket', reason: 'no workspace association' }]);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /INSERT INTO workspace_buckets/);
    assert.match(queries[0].sql, /ON CONFLICT \(bucket_name\) DO NOTHING/);
    assert.deepEqual(queries[0].params, ['wX', 'acme', 'acme-legacy', 'us-east-1']);
  });

  it('requires an associate resolver', async () => {
    await assert.rejects(() => insertMissingWorkspaceBucketRows([{ bucketName: 'x' }], {}), /associate/);
  });
});
