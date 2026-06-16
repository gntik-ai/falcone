// Black-box test suite for change fix-storage-bucket-ownership-and-identity.
// Drives the PUBLIC STORAGE_HANDLERS export from
// deploy/kind/control-plane/storage-handlers.mjs only.
// Reproduces BUG-STOR-1, BUG-STOR-2 (IDOR: cross-tenant access to another
// tenant's bucket/workspace/objects/metadata/usage is currently 200; must be 404).
//
// Tests:
//   bbx-stor-idor-01: Tenant B lists Tenant A's objects by bucketId → 404
//   bbx-stor-idor-02: Tenant B reads Tenant A's object metadata by bucketId → 404
//   bbx-stor-idor-03: Tenant B reads Tenant A's workspace usage by workspaceId → 404
//   bbx-stor-idor-04: GET /v1/storage/buckets returns only the caller's own buckets
//   bbx-stor-idor-05: Tenant A can still list its own objects (no regressions)
//   bbx-stor-idor-06: Tenant A can still read its own object metadata
//   bbx-stor-idor-07: Tenant A can still read its own workspace usage
//   bbx-stor-idor-08: storageProvisionBucket rejects cross-tenant workspace (403)
//   bbx-stor-idor-09: superadmin still sees all buckets on GET /v1/storage/buckets
//   bbx-stor-idor-10: superadmin can list objects in any bucket (no 404)

import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_HANDLERS } from '../../deploy/kind/control-plane/storage-handlers.mjs';

const { storageListBuckets, storageListObjects, storageObjectMetadata, storageWorkspaceUsage, storageProvisionBucket } = STORAGE_HANDLERS;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_A     = 'ws-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B     = 'ws-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BUCKET_A = 'bucket-a-demo';
const BUCKET_B = 'bucket-b-demo';

// workspace_buckets rows keyed by bucket_name
const BUCKET_ROWS = {
  [BUCKET_A]: { id: 'id-a', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_B]: { id: 'id-b', workspace_id: WS_B, tenant_id: TENANT_B, bucket_name: BUCKET_B, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' }
};

// workspace rows keyed by workspace id
const WORKSPACE_ROWS = {
  [WS_A]: { id: WS_A, tenant_id: TENANT_A, slug: 'ws-a', display_name: 'Workspace A', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  [WS_B]: { id: WS_B, tenant_id: TENANT_B, slug: 'ws-b', display_name: 'Workspace B', status: 'active', created_at: '2026-01-01T00:00:00Z' }
};

// Build an in-memory pool mock that answers the SQL queries used by the store helpers.
// The store helpers we care about:
//   bucketWorkspaceMap(pool)          → SELECT bucket_name, workspace_id, tenant_id, ... FROM workspace_buckets (no WHERE)
//   getBucketRecord(pool, bucketName) → SELECT ... FROM workspace_buckets WHERE bucket_name=$1
//   listBucketsForWorkspace(pool, id) → SELECT ... FROM workspace_buckets WHERE workspace_id=$1
//   getWorkspace(pool, idOrSlug)      → SELECT ... FROM workspaces WHERE id=$1 OR slug=$1
//   insertBucket(pool, ...)           → INSERT INTO workspace_buckets ...
function makeMockPool({ buckets = BUCKET_ROWS, workspaces = WORKSPACE_ROWS } = {}) {
  return {
    query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      // getBucketRecord — WHERE bucket_name=$1
      if (s.includes('from workspace_buckets') && s.includes('where bucket_name')) {
        const bucketName = params[0];
        const row = buckets[bucketName] ?? null;
        return Promise.resolve({ rows: row ? [row] : [] });
      }

      // bucketWorkspaceMap — SELECT ... FROM workspace_buckets (no WHERE)
      if (s.includes('from workspace_buckets') && !s.includes('where')) {
        return Promise.resolve({ rows: Object.values(buckets) });
      }

      // listBucketsForWorkspace — WHERE workspace_id=$1
      if (s.includes('from workspace_buckets') && s.includes('where workspace_id')) {
        const wsId = params[0];
        const rows = Object.values(buckets).filter((r) => r.workspace_id === wsId);
        return Promise.resolve({ rows });
      }

      // insertBucket — INSERT INTO workspace_buckets
      if (s.includes('insert into workspace_buckets')) {
        const [wsId, tenantId, bucketName, region] = params;
        const row = { id: 'new-id', workspace_id: wsId, tenant_id: tenantId, bucket_name: bucketName, region, created_at: new Date().toISOString() };
        return Promise.resolve({ rows: [row] });
      }

      // getWorkspace — WHERE id=$1 OR slug=$1
      if (s.includes('from workspaces') && s.includes('id = $1 or slug = $1')) {
        const id = params[0];
        const ws = workspaces[id] ?? Object.values(workspaces).find((w) => w.slug === id) ?? null;
        return Promise.resolve({ rows: ws ? [ws] : [] });
      }

      // Fallback: empty result
      return Promise.resolve({ rows: [] });
    }
  };
}

// identity helpers
const tenantAIdentity = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_developer' };
const tenantBIdentity = { sub: 'user-b', tenantId: TENANT_B, workspaceId: WS_B, actorType: 'tenant_developer' };
const superadminIdentity = { sub: 'sa', tenantId: null, actorType: 'superadmin' };

// Stub globalThis.fetch so no real S3 calls are made.
// Successful S3 response stubs per bucket.
function withStubbedFetch(bucketObjects, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    // Detect which bucket is being accessed
    const matchedBucket = Object.keys(bucketObjects).find((b) => u.includes(`/${b}`));
    const xml = matchedBucket ? bucketObjects[matchedBucket] : '<ListBucketResult><Contents/></ListBucketResult>';
    return {
      ok: true,
      status: 200,
      headers: new Map([
        ['content-type', 'text/plain'],
        ['content-length', '10'],
        ['etag', '"abc123"'],
        ['last-modified', 'Mon, 01 Jan 2026 00:00:00 GMT']
      ]),
      text: async () => xml
    };
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

const BUCKET_A_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET_A}</Name><Prefix></Prefix><MaxKeys>50</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>a-doc.txt</Key><Size>29</Size><ETag>&#34;eceeaa79&#34;</ETag><StorageClass>STANDARD</StorageClass><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>
  <KeyCount>1</KeyCount>
</ListBucketResult>`;

const BUCKET_B_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET_B}</Name><Prefix></Prefix><MaxKeys>50</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>b-doc.txt</Key><Size>35</Size><ETag>&#34;abcdef12&#34;</ETag><StorageClass>STANDARD</StorageClass><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>
  <KeyCount>1</KeyCount>
</ListBucketResult>`;

// ---------------------------------------------------------------------------
// bbx-stor-idor-01: Tenant B lists Tenant A's objects → 404 (no existence leak)
// ---------------------------------------------------------------------------
test('bbx-stor-idor-01: cross-tenant listObjects via bucketId → 404', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_A]: BUCKET_A_XML, [BUCKET_B]: BUCKET_B_XML }, async () => {
    const ctx = { params: { bucketId: BUCKET_A }, query: {}, identity: tenantBIdentity, pool };
    const res = await storageListObjects(ctx);
    assert.equal(res.statusCode, 404, `expected 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    // Must not leak any object keys from Tenant A
    assert.ok(!JSON.stringify(res.body).includes('a-doc.txt'), 'must not leak object key');
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-02: Tenant B reads Tenant A's object metadata → 404
// ---------------------------------------------------------------------------
test('bbx-stor-idor-02: cross-tenant objectMetadata via bucketId → 404', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_A]: BUCKET_A_XML }, async () => {
    const ctx = { params: { bucketId: BUCKET_A, objectKey: 'a-doc.txt' }, query: {}, identity: tenantBIdentity, pool };
    const res = await storageObjectMetadata(ctx);
    assert.equal(res.statusCode, 404, `expected 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-03: Tenant B reads Tenant A's workspace usage → 404
// ---------------------------------------------------------------------------
test('bbx-stor-idor-03: cross-tenant workspaceUsage via workspaceId → 404', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_A]: BUCKET_A_XML }, async () => {
    // Tenant B's identity requests Tenant A's workspaceId
    const ctx = { params: { workspaceId: WS_A }, query: {}, identity: tenantBIdentity, pool };
    const res = await storageWorkspaceUsage(ctx);
    assert.equal(res.statusCode, 404, `expected 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-04: GET /v1/storage/buckets returns ONLY the caller's own buckets
// ---------------------------------------------------------------------------
test('bbx-stor-idor-04: listBuckets returns only caller-tenant buckets', async () => {
  const pool = makeMockPool();
  // S3 returns both buckets (no per-tenant filtering at S3 layer)
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>admin</ID><DisplayName>admin</DisplayName></Owner>
  <Buckets>
    <Bucket><Name>${BUCKET_A}</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket>
    <Bucket><Name>${BUCKET_B}</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket>
  </Buckets>
</ListAllMyBucketsResult>`
  });
  try {
    const ctx = { params: {}, query: {}, identity: tenantAIdentity, pool };
    const res = await storageListBuckets(ctx);
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
    const { items } = res.body;
    // Must only see Tenant A's bucket
    assert.equal(items.length, 1, `expected 1 item (own bucket), got ${items.length}: ${JSON.stringify(items)}`);
    assert.equal(items[0].resourceId, BUCKET_A);
    assert.equal(items[0].tenantId, TENANT_A);
    // Must NOT include Tenant B's bucket
    assert.ok(!items.some((i) => i.tenantId === TENANT_B), 'must not include Tenant B buckets');
  } finally {
    delete globalThis.fetch;
  }
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-05: Tenant A can list its OWN objects (no regressions)
// ---------------------------------------------------------------------------
test('bbx-stor-idor-05: own-bucket listObjects succeeds for the owning tenant', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_A]: BUCKET_A_XML }, async () => {
    const ctx = { params: { bucketId: BUCKET_A }, query: {}, identity: tenantAIdentity, pool };
    const res = await storageListObjects(ctx);
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.items.length > 0, 'should return objects');
    assert.equal(res.body.items[0].objectKey, 'a-doc.txt');
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-06: Tenant A can read its OWN object metadata (no regressions)
// ---------------------------------------------------------------------------
test('bbx-stor-idor-06: own-bucket objectMetadata succeeds for the owning tenant', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_A]: BUCKET_A_XML }, async () => {
    const ctx = { params: { bucketId: BUCKET_A, objectKey: 'a-doc.txt' }, query: {}, identity: tenantAIdentity, pool };
    const res = await storageObjectMetadata(ctx);
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-07: Tenant A can read its OWN workspace usage (no regressions)
// ---------------------------------------------------------------------------
test('bbx-stor-idor-07: own workspace usage succeeds for the owning tenant', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_A]: BUCKET_A_XML }, async () => {
    const ctx = { params: { workspaceId: WS_A }, query: {}, identity: tenantAIdentity, pool };
    const res = await storageWorkspaceUsage(ctx);
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.dimensions, 'should return usage dimensions');
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-08: storageProvisionBucket rejects cross-tenant workspace → 404
// ---------------------------------------------------------------------------
test('bbx-stor-idor-08: provisionBucket for cross-tenant workspace → 404', async () => {
  const pool = makeMockPool();
  // Tenant B requests to provision a bucket in Tenant A's workspace
  const ctx = { params: { workspaceId: WS_A }, body: { name: 'hijack-bucket' }, query: {}, identity: tenantBIdentity, pool };
  const res = await storageProvisionBucket(ctx);
  assert.equal(res.statusCode, 404, `expected 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-09: superadmin sees ALL buckets on GET /v1/storage/buckets
// ---------------------------------------------------------------------------
test('bbx-stor-idor-09: superadmin listBuckets sees all tenants buckets', async () => {
  const pool = makeMockPool();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>admin</ID><DisplayName>admin</DisplayName></Owner>
  <Buckets>
    <Bucket><Name>${BUCKET_A}</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket>
    <Bucket><Name>${BUCKET_B}</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket>
  </Buckets>
</ListAllMyBucketsResult>`
  });
  try {
    const ctx = { params: {}, query: {}, identity: superadminIdentity, pool };
    const res = await storageListBuckets(ctx);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 2, `superadmin must see all 2 buckets, got ${JSON.stringify(res.body.items)}`);
  } finally {
    delete globalThis.fetch;
  }
});

// ---------------------------------------------------------------------------
// bbx-stor-idor-10: superadmin can list objects in any tenant's bucket
// ---------------------------------------------------------------------------
test('bbx-stor-idor-10: superadmin listObjects succeeds for any bucket', async () => {
  const pool = makeMockPool();
  await withStubbedFetch({ [BUCKET_B]: BUCKET_B_XML }, async () => {
    const ctx = { params: { bucketId: BUCKET_B }, query: {}, identity: superadminIdentity, pool };
    const res = await storageListObjects(ctx);
    assert.equal(res.statusCode, 200, `superadmin should be able to list any bucket, got ${res.statusCode}`);
  });
});
