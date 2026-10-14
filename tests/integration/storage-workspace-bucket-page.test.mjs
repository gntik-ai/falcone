import test from 'node:test';
import assert from 'node:assert/strict';
import { listWorkspaceBucketsPage } from '../../apps/control-plane/tenant-store.mjs';

test('Postgres: workspace bucket pages isolate tenant/workspace and walk strict sorted cursors', async (t) => {
  const dsn = process.env.STORAGE_BUCKET_LIST_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.STORAGE_BUCKET_LIST_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres');
    return t.skip('STORAGE_BUCKET_LIST_TEST_DATABASE_URL is absent; a dedicated real Postgres is required');
  }
  const { Client } = (await import('pg')).default;
  const client = new Client({ connectionString: dsn });
  try {
    await client.connect();
    // Session-local table shadows the registry; no existing data is read or changed.
    await client.query(`CREATE TEMP TABLE workspace_buckets (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id text NOT NULL, tenant_id text NOT NULL,
      bucket_name text NOT NULL UNIQUE, region text NOT NULL DEFAULT 'us-east-1',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query(`INSERT INTO workspace_buckets (workspace_id, tenant_id, bucket_name, region) VALUES
      ('ws1', 'tenant-a', 'bucket-z', 'eu-west-1'),
      ('ws2', 'tenant-a', 'bucket-prod', 'eu-west-1'),
      ('ws1', 'tenant-a', 'bucket-a', 'eu-west-1'),
      ('ws1', 'tenant-b', 'bucket-b', 'eu-west-1'),
      ('ws3', 'tenant-b', 'bucket-other', 'eu-west-1'),
      ('ws1', 'tenant-a', 'bucket-m', 'eu-west-1')`);

    const first = await listWorkspaceBucketsPage(client, 'ws1', 'tenant-a', { size: 2 });
    assert.deepEqual(first.items.map((row) => row.bucket_name), ['bucket-a', 'bucket-m']);
    assert.equal(first.nextCursor, 'bucket-m');
    const last = await listWorkspaceBucketsPage(client, 'ws1', 'tenant-a', { size: 2, after: first.nextCursor });
    assert.deepEqual(last.items.map((row) => row.bucket_name), ['bucket-z']);
    assert.ok(!Object.hasOwn(last, 'nextCursor'));
    assert.deepEqual(await listWorkspaceBucketsPage(client, 'ws1', 'tenant-a', { size: 2, after: 'bucket-z' }), { items: [] });

    const fullFinal = await listWorkspaceBucketsPage(client, 'ws1', 'tenant-a', { size: 3 });
    assert.deepEqual(fullFinal.items.map((row) => row.bucket_name), ['bucket-a', 'bucket-m', 'bucket-z']);
    assert.ok(!Object.hasOwn(fullFinal, 'nextCursor'));
    assert.deepEqual(await listWorkspaceBucketsPage(client, 'ws2', 'tenant-b'), { items: [] });
    const literalCursor = await listWorkspaceBucketsPage(client, 'ws1', 'tenant-a', { size: 200, after: "bucket-a' OR 1=1 --" });
    assert.deepEqual(literalCursor.items.map((row) => row.bucket_name), ['bucket-m', 'bucket-z']);
  } finally {
    await client.end();
  }
});
