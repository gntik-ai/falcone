import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../apps/control-plane/tenant-store.mjs';

test('workspace bucket page binds tenant, workspace and strict name cursor, with one lookahead row', async () => {
  const after = "bucket-a' OR 1=1 --";
  const pool = { async query(sql, params) {
    assert.match(sql, /FROM workspace_buckets\s+WHERE workspace_id=\$1 AND tenant_id=\$2/i);
    assert.match(sql, /\$3::text IS NULL OR bucket_name > \$3/);
    assert.match(sql, /ORDER BY bucket_name\s+LIMIT \$4/i);
    assert.ok(!sql.includes(after), 'cursor remains a bind value');
    assert.deepEqual(params, ['ws1', 'tenant-a', after, 3]);
    return { rows: [{ bucket_name: 'bucket-b' }, { bucket_name: 'bucket-c' }, { bucket_name: 'bucket-d' }] };
  } };
  assert.deepEqual(await store.listWorkspaceBucketsPage(pool, 'ws1', 'tenant-a', { size: 2, after }), {
    items: [{ bucket_name: 'bucket-b' }, { bucket_name: 'bucket-c' }], nextCursor: 'bucket-c',
  });
});

test('full final and empty registry pages omit nextCursor', async () => {
  for (const rows of [[{ bucket_name: 'bucket-z' }], []]) {
    const pool = { async query(sql, params) {
      assert.deepEqual(params, ['ws1', 'tenant-a', null, 2]);
      return { rows };
    } };
    assert.deepEqual(await store.listWorkspaceBucketsPage(pool, 'ws1', 'tenant-a', { size: 1 }), { items: rows });
  }
});
