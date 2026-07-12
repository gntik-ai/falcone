// add-storage-object-io-completeness (#676): the live object-store API gained presigned/temporary
// URLs, multipart/resumable upload, HTTP range/partial reads, and per-bucket delete. This suite
// drives the PUBLIC storage runtime (routes.mjs route table + STORAGE_HANDLERS) and the gateway-config
// route catalog only — no real S3/SeaweedFS. It encodes the four acceptance scenarios from the
// spec change AND the cardinal tenant-isolation guarantee (every new route is ownership-gated;
// a cross-tenant caller gets 404 with no existence leak).
//
// NOTE: a fake S3 fetch seam cannot prove that real SeaweedFS honors Range / multipart / presign —
// that is the live checker's job. These tests prove the HANDLER LOGIC, WIRING, and ISOLATION.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { routes } from '../../apps/control-plane/routes.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const {
  storageGetObject, storageDeleteBucket, storagePresignObject,
  storageMultipartInitiate, storageMultipartUploadPart, storageMultipartComplete, storageMultipartAbort
} = STORAGE_HANDLERS;

// ---------------------------------------------------------------------------
// Fixtures (mirror storage-bucket-ownership-idor.test.mjs)
// ---------------------------------------------------------------------------
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_A = 'ws-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BUCKET_A = 'ws-abc123def456-assets';
const BUCKET_B = 'ws-zzz999yyy888-assets';

const BUCKET_ROWS = {
  [BUCKET_A]: { id: 'id-a', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_B]: { id: 'id-b', workspace_id: 'ws-b', tenant_id: TENANT_B, bucket_name: BUCKET_B, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' }
};

// In-memory pool. Records DELETE FROM workspace_buckets so we can assert the registry row
// removal. listBucketsForWorkspace returns only the owning workspace's buckets.
function makeMockPool({ buckets = { ...BUCKET_ROWS } } = {}) {
  const deletedBucketRecords = [];
  return {
    deletedBucketRecords,
    query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (s.startsWith('delete from workspace_buckets')) {
        const name = params[0];
        const row = buckets[name];
        if (row) { deletedBucketRecords.push(name); delete buckets[name]; return Promise.resolve({ rows: [row] }); }
        return Promise.resolve({ rows: [] });
      }
      if (s.includes('from workspace_buckets') && s.includes('where bucket_name')) {
        const row = buckets[params[0]] ?? null;
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (s.includes('from workspace_buckets') && s.includes('where workspace_id')) {
        const rows = Object.values(buckets).filter((r) => r.workspace_id === params[0]);
        return Promise.resolve({ rows });
      }
      if (s.includes('from workspace_buckets')) return Promise.resolve({ rows: Object.values(buckets) });
      return Promise.resolve({ rows: [] });
    }
  };
}

const tenantAIdentity = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_owner' };
const tenantBIdentity = { sub: 'user-b', tenantId: TENANT_B, workspaceId: 'ws-b', actorType: 'tenant_owner' };

// A recording SeaweedFS client seam (the handlers thread ctx.seaweedClient into the identity
// revoke calls; with this fake no real k8s request is made). A GET on a Job status path returns
// `succeeded: 1` so the issuer's waitJobComplete poll resolves immediately (otherwise it would
// busy-poll the real 30×2s timeout against this in-memory fake).
function makeSeaweedClient() {
  const calls = [];
  const client = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/jobs/')) return { status: { succeeded: 1 } };
    return {};
  };
  client.calls = calls;
  return client;
}

// Build a ctx with a Range header on ctx.req (the handler reads ctx.req.headers.range).
function ctxFor(params, { identity = tenantAIdentity, pool, body = {}, range, rawBody, contentType, seaweedClient } = {}) {
  return {
    params, query: {}, body, identity, pool,
    req: { headers: range ? { range } : {} },
    ...(rawBody ? { rawBody, rawBodyIsBinary: true, contentType: contentType ?? 'application/octet-stream' } : {}),
    ...(seaweedClient ? { seaweedClient } : {})
  };
}

// Stub globalThis.fetch. `handler(url, opts)` returns a fake S3 Response.
function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts ?? {});
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

function s3Response({ status = 200, headers = {}, body = '' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8')
  };
}

const NEW_ROUTES = [
  ['DELETE', '/v1/storage/buckets/{bucketId}', 'storageDeleteBucket'],
  ['POST', '/v1/storage/buckets/{bucketId}/objects/{objectKey}/presign', 'storagePresignObject'],
  ['POST', '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart', 'storageMultipartInitiate'],
  ['PUT', '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}/parts/{partNumber}', 'storageMultipartUploadPart'],
  ['POST', '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}/complete', 'storageMultipartComplete'],
  ['DELETE', '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}', 'storageMultipartAbort']
];

// ===========================================================================
// Wiring: every new route is registered, requires auth, and has a handler
// ===========================================================================
test('bbx-stor-io-wiring: each new object-I/O route is registered with a handler and requires auth', () => {
  for (const [method, path, handlerName] of NEW_ROUTES) {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `${method} ${path} is registered (not NO_ROUTE)`);
    assert.equal(route.localHandler, handlerName, `${method} ${path} maps to ${handlerName}`);
    assert.equal(typeof STORAGE_HANDLERS[route.localHandler], 'function', `${handlerName} handler exists`);
    assert.equal(route.auth, 'authenticated', `${method} ${path} requires auth`);
  }
});

test('bbx-stor-io-catalog: the gateway-config catalog advertises every new object-I/O route', () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../deploy/gateway-config/public-route-catalog.json', import.meta.url)), 'utf8'));
  const advertised = new Set(catalog.map((r) => `${r.method} ${r.path}`));
  for (const [method, path] of NEW_ROUTES) {
    assert.ok(advertised.has(`${method} ${path}`), `catalog advertises ${method} ${path}`);
  }
});

// ===========================================================================
// Scenario 2: Range read returns 206 with only the requested bytes + Content-Range
// ===========================================================================
test('bbx-stor-io-range-206: GET with a Range header returns 206 + Content-Range and only the partial bytes', async () => {
  const pool = makeMockPool();
  // S3 honors the range: returns 206 with 4 bytes and a Content-Range header.
  await withFetch((_url, opts) => {
    assert.ok(opts.headers && (opts.headers.range || opts.headers.Range), 'range header is forwarded to the backend');
    return s3Response({ status: 206, headers: { 'content-type': 'text/plain', 'content-length': '4', 'content-range': 'bytes 0-3/20' }, body: 'PART' });
  }, async () => {
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'range20.txt' }, { pool, range: 'bytes=0-3' }));
    assert.equal(res.statusCode, 206, `expected 206, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.headers['content-range'], 'bytes 0-3/20');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.body.partial, true);
    assert.equal(res.body.sizeBytes, 4, 'only the partial byte count is reported');
    assert.equal(Buffer.from(res.body.contentBase64, 'base64').toString('utf8'), 'PART');
  });
});

test('bbx-stor-io-range-full: GET without a Range header is unchanged (200, full body, Accept-Ranges advertised)', async () => {
  const pool = makeMockPool();
  await withFetch(() => s3Response({ status: 200, headers: { 'content-type': 'text/plain', 'content-length': '20' }, body: 'TWENTY-BYTES-PADDING' }), async () => {
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'range20.txt' }, { pool }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.body.sizeBytes, 20);
  });
});

test('bbx-stor-io-range-416: an unsatisfiable Range yields a clean 416 (no raw S3 XML leak)', async () => {
  const pool = makeMockPool();
  await withFetch(() => s3Response({ status: 416, body: '<Error><Code>InvalidRange</Code><Resource>/ws-abc123def456-assets/range20.txt</Resource></Error>' }), async () => {
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'range20.txt' }, { pool, range: 'bytes=999-1000' }));
    assert.equal(res.statusCode, 416);
    assert.equal(res.body.code, 'STORAGE_RANGE_NOT_SATISFIABLE');
    assert.ok(!JSON.stringify(res.body).includes('Resource'), 'must not leak raw S3 XML / physical path');
  });
});

test('bbx-stor-io-range-idor: cross-tenant Range GET is 404 BEFORE any backend call', async () => {
  const pool = makeMockPool();
  let fetched = false;
  await withFetch(() => { fetched = true; return s3Response({ status: 206 }); }, async () => {
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'range20.txt' }, { pool, identity: tenantBIdentity, range: 'bytes=0-3' }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'BUCKET_NOT_FOUND');
  });
  assert.equal(fetched, false, 'ownership gate must run before the S3 call');
});

// ===========================================================================
// Scenario 1: Presigned URL — scoped, TTL-clamped, ownership-gated, no secret leak
// ===========================================================================
test('bbx-stor-io-presign-download: a download presigned URL is scoped to the bucket+key and is a GET', async () => {
  const pool = makeMockPool();
  const res = await storagePresignObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'doc.txt' }, { pool, body: { operation: 'download', ttlSeconds: 120 } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.operation, 'download');
  assert.equal(res.body.bucketName, BUCKET_A);
  assert.equal(res.body.objectKey, 'doc.txt');
  assert.equal(res.body.ttlSeconds, 120);
  const u = new URL(res.body.url);
  assert.ok(u.pathname.includes(BUCKET_A) && u.pathname.endsWith('doc.txt'), 'URL path is bound to this bucket+key');
  assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.ok(u.searchParams.get('X-Amz-Signature'), 'a SigV4 signature is present');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '120');
});

test('bbx-stor-io-presign-clamp: a TTL beyond the platform max is clamped (ttlClamped=true)', async () => {
  const pool = makeMockPool();
  const res = await storagePresignObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'doc.txt' }, { pool, body: { operation: 'upload', ttlSeconds: 9999999 } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ttlClamped, true);
  assert.ok(res.body.ttlSeconds <= 3600, `clamped to <= platform max, got ${res.body.ttlSeconds}`);
  assert.equal(new URL(res.body.url).searchParams.get('X-Amz-Expires'), String(res.body.ttlSeconds));
});

test('bbx-stor-io-presign-secret: the presigned URL never contains the SigV4 secret', async () => {
  const pool = makeMockPool();
  const res = await storagePresignObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'doc.txt' }, { pool, body: { operation: 'download' } }));
  // The signing secret env is unset in tests; assert no obvious secret material is echoed and that
  // only the derived signature (hex) rides the URL.
  assert.ok(!/secretKey|X-Amz-Security-Token/i.test(res.body.url));
  assert.ok(!('secretKey' in res.body));
});

test('bbx-stor-io-presign-badop: an invalid operation is rejected with 400', async () => {
  const pool = makeMockPool();
  const res = await storagePresignObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'doc.txt' }, { pool, body: { operation: 'list' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_PRESIGN_OPERATION');
});

test('bbx-stor-io-presign-idor: a cross-tenant presign request is 404 (no URL minted)', async () => {
  const pool = makeMockPool();
  const res = await storagePresignObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'doc.txt' }, { pool, identity: tenantBIdentity, body: { operation: 'download' } }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'BUCKET_NOT_FOUND');
  assert.ok(!('url' in res.body), 'no presigned URL is returned to a non-owner');
});

// ===========================================================================
// Scenario 4: Per-bucket delete — physical + registry + identity, ownership-gated
// ===========================================================================
test('bbx-stor-io-delete-bucket: owner delete removes the physical bucket, the registry row, and the identity', async () => {
  const pool = makeMockPool();
  const seaweedClient = makeSeaweedClient();
  let physicalDelete = false;
  await withFetch((url, opts) => {
    if (opts.method === 'DELETE' && url.includes(`/${BUCKET_A}`)) physicalDelete = true;
    return s3Response({ status: 204 });
  }, async () => {
    const res = await storageDeleteBucket(ctxFor({ bucketId: BUCKET_A }, { pool, seaweedClient }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { bucket: BUCKET_A, deleted: true });
  });
  assert.equal(physicalDelete, true, 'the physical SeaweedFS bucket is deleted');
  assert.deepEqual(pool.deletedBucketRecords, [BUCKET_A], 'the workspace_buckets registry row is deleted');
  assert.ok(seaweedClient.calls.some((c) => c.method === 'POST' && c.path.includes('/jobs')), 'a SeaweedFS identity-revoke job is posted (best-effort credential cleanup)');
});

test('bbx-stor-io-delete-bucket-idor: a cross-tenant bucket delete is 404 and deletes nothing', async () => {
  const pool = makeMockPool();
  let fetched = false;
  await withFetch(() => { fetched = true; return s3Response({ status: 204 }); }, async () => {
    const res = await storageDeleteBucket(ctxFor({ bucketId: BUCKET_A }, { pool, identity: tenantBIdentity }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'BUCKET_NOT_FOUND');
  });
  assert.equal(fetched, false, 'no physical delete is attempted for a non-owner');
  assert.deepEqual(pool.deletedBucketRecords, [], 'no registry row is deleted');
});

test('bbx-stor-io-delete-bucket-missing: deleting an unknown bucket is 404', async () => {
  const pool = makeMockPool();
  const res = await storageDeleteBucket(ctxFor({ bucketId: 'ws-nope-nope-assets' }, { pool }));
  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// Scenario 3: Multipart — initiate / upload-part / complete / abort, gated + quota
// ===========================================================================
test('bbx-stor-io-multipart-initiate: returns an opaque uploadId for the owner', async () => {
  const pool = makeMockPool();
  await withFetch((url, opts) => {
    assert.ok(url.includes('uploads='), 'CreateMultipartUpload uses ?uploads');
    assert.equal(opts.method, 'POST');
    return s3Response({ status: 200, body: '<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>big.bin</Key><UploadId>UP-123</UploadId></InitiateMultipartUploadResult>' });
  }, async () => {
    const res = await storageMultipartInitiate(ctxFor({ bucketId: BUCKET_A, objectKey: 'big.bin' }, { pool, body: {} }));
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.uploadId, 'UP-123');
    assert.equal(res.body.bucketName, BUCKET_A);
    assert.equal(res.body.objectKey, 'big.bin');
  });
});

test('bbx-stor-io-multipart-uploadpart: returns the part ETag', async () => {
  const pool = makeMockPool();
  await withFetch((url, opts) => {
    assert.ok(url.includes('partNumber=1') && url.includes('uploadId=UP-123'), 'UploadPart carries partNumber+uploadId');
    assert.equal(opts.method, 'PUT');
    return s3Response({ status: 200, headers: { etag: '"etag-part-1"' } });
  }, async () => {
    const res = await storageMultipartUploadPart(ctxFor(
      { bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123', partNumber: '1' },
      { pool, rawBody: Buffer.from('chunk-1-bytes'), contentType: 'application/octet-stream' }
    ));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.partNumber, 1);
    assert.equal(res.body.etag, 'etag-part-1');
  });
});

test('bbx-stor-io-multipart-uploadpart-badnum: a part number out of range is 400', async () => {
  const pool = makeMockPool();
  const res = await storageMultipartUploadPart(ctxFor(
    { bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123', partNumber: '0' },
    { pool, rawBody: Buffer.from('x') }
  ));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_PART_NUMBER');
});

test('bbx-stor-io-multipart-complete: assembles the object from an ordered part list', async () => {
  const pool = makeMockPool();
  await withFetch((url, opts) => {
    assert.ok(url.includes('uploadId=UP-123'), 'CompleteMultipartUpload carries uploadId');
    assert.equal(opts.method, 'POST');
    return s3Response({ status: 200, body: '<CompleteMultipartUploadResult><Location>http://s/b/big.bin</Location><ETag>&#34;final-etag&#34;</ETag></CompleteMultipartUploadResult>' });
  }, async () => {
    const res = await storageMultipartComplete(ctxFor(
      { bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123' },
      { pool, body: { parts: [{ partNumber: 1, etag: 'etag-part-1' }, { partNumber: 2, etag: 'etag-part-2' }] } }
    ));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.completed, true);
    assert.equal(res.body.etag, 'final-etag');
    assert.equal(res.body.parts, 2);
  });
});

test('bbx-stor-io-multipart-complete-badlist: a gapped/unordered part list is rejected 400 before the backend call', async () => {
  const pool = makeMockPool();
  let fetched = false;
  await withFetch(() => { fetched = true; return s3Response({ status: 200 }); }, async () => {
    const res = await storageMultipartComplete(ctxFor(
      { bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123' },
      { pool, body: { parts: [{ partNumber: 1, etag: 'e1' }, { partNumber: 3, etag: 'e3' }] } }
    ));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INVALID_PART_LIST');
  });
  assert.equal(fetched, false, 'an invalid part list is rejected before the backend completion call');
});

test('bbx-stor-io-multipart-complete-quota: completion enforces the per-workspace byte quota (no bypass)', async () => {
  const pool = makeMockPool();
  process.env.STORAGE_MAX_BYTES = '10'; // tiny limit so the assembled object exceeds it
  let deletedAssembled = false;
  try {
    await withFetch((url, opts) => {
      if (opts.method === 'POST' && url.includes('uploadId=')) {
        return s3Response({ status: 200, body: '<CompleteMultipartUploadResult><ETag>&#34;final&#34;</ETag></CompleteMultipartUploadResult>' });
      }
      if (opts.method === 'HEAD') return s3Response({ status: 200, headers: { 'content-length': '100', 'content-type': 'application/octet-stream' } });
      if (opts.method === 'GET') return s3Response({ status: 200, body: '<ListBucketResult><Contents><Key>big.bin</Key><Size>100</Size></Contents></ListBucketResult>' });
      if (opts.method === 'DELETE') { deletedAssembled = true; return s3Response({ status: 204 }); }
      return s3Response({ status: 200 });
    }, async () => {
      const res = await storageMultipartComplete(ctxFor(
        { bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123' },
        { pool, body: { parts: [{ partNumber: 1, etag: 'e1' }] } }
      ));
      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
      assert.equal(res.body.code, 'STORAGE_QUOTA_EXCEEDED');
    });
    assert.equal(deletedAssembled, true, 'the over-quota assembled object is rolled back (deleted)');
  } finally {
    delete process.env.STORAGE_MAX_BYTES;
  }
});

test('bbx-stor-io-multipart-abort: aborts an in-progress upload (cleanup)', async () => {
  const pool = makeMockPool();
  await withFetch((url, opts) => {
    assert.equal(opts.method, 'DELETE');
    assert.ok(url.includes('uploadId=UP-123'), 'AbortMultipartUpload carries uploadId');
    return s3Response({ status: 204 });
  }, async () => {
    const res = await storageMultipartAbort(ctxFor({ bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123' }, { pool }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.aborted, true);
  });
});

test('bbx-stor-io-multipart-idor: every multipart route is ownership-gated (cross-tenant → 404, no backend call)', async () => {
  const pool = makeMockPool();
  let fetched = false;
  await withFetch(() => { fetched = true; return s3Response({ status: 200 }); }, async () => {
    const base = { bucketId: BUCKET_A, objectKey: 'big.bin', uploadId: 'UP-123', partNumber: '1' };
    const opts = { pool, identity: tenantBIdentity, body: { parts: [{ partNumber: 1, etag: 'e1' }] }, rawBody: Buffer.from('x') };
    for (const handler of [storageMultipartInitiate, storageMultipartUploadPart, storageMultipartComplete, storageMultipartAbort]) {
      const res = await handler(ctxFor(base, opts));
      assert.equal(res.statusCode, 404, `${handler.name} must 404 cross-tenant`);
      assert.equal(res.body.code, 'BUCKET_NOT_FOUND');
    }
  });
  assert.equal(fetched, false, 'no multipart route reaches the backend for a non-owner');
});
