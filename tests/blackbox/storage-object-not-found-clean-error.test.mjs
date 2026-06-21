// fix-storage-object-not-found-clean-error (#675)
//
// A tenant downloading (or reading metadata of) a MISSING object in a bucket it OWNS got a 404,
// but the tenant-facing body leaked the raw SeaweedFS S3 error payload: the literal
// STORAGE_GET_FAILED / STORAGE_HEAD_FAILED code, the `s3 GET/HEAD … -> 404:` wrapper, the S3 XML
// (NoSuchKey, <Resource>, <RequestId>), and the INTERNAL physical bucket path `ws-<hash>-…`.
//
// The handlers (deploy/kind/control-plane/storage-handlers.mjs) now map a backend 404 — which,
// after the ownership gate has already passed, is unambiguously a missing object — to a stable,
// structured `404 OBJECT_NOT_FOUND` with a clean message and NO backend internals; and a non-404
// backend failure keeps its operation-specific failure code but with a generic message (no raw
// payload). This drives the PUBLIC STORAGE_HANDLERS export only; globalThis.fetch is stubbed so
// no real S3 call is made (saved/restored in try/finally).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_HANDLERS } from '../../deploy/kind/control-plane/storage-handlers.mjs';

const { storageGetObject, storageObjectMetadata } = STORAGE_HANDLERS;

// Identity owns the bucket; the mock pool returns a workspace_buckets row owned by the caller so
// the ownership gate (getBucketRecord → rec.tenant_id === identity.tenantId) PASSES and the
// handler proceeds to the S3 call (where our fetch stub returns the 404 we want to test).
const owner = { actorType: 'tenant_owner', tenantId: 'ten_1' };
const ownedBucketPool = {
  query: async () => ({
    rows: [{ id: 'b', workspace_id: 'w', tenant_id: 'ten_1', bucket_name: 'b1', region: 'us-east-1', created_at: new Date().toISOString() }]
  })
};

// Raw SeaweedFS S3 "NoSuchKey" body for a missing object — exactly the kind of payload that must
// NOT reach the tenant. It embeds the internal physical bucket path `ws-<hash>-…`.
const NO_SUCH_KEY_XML = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>missing.txt</Key><Resource>/ws-1a2b3c4d5e6f-assets/missing.txt</Resource><RequestId>17ABC0000DEADBEEF</RequestId></Error>`;

// Substrings that prove a leak of backend internals; none may appear in the tenant-facing message.
const LEAK_MARKERS = ['NoSuchKey', '<Resource', 'RequestId', 'ws-', 's3 GET', 's3 HEAD', '<?xml', '<Error'];

function assertNoLeak(message) {
  const text = String(message ?? '');
  for (const marker of LEAK_MARKERS) {
    assert.ok(!text.includes(marker), `tenant-facing message must not leak "${marker}" — got: ${text}`);
  }
}

// Build a minimal fetch stub matching the real `s3()` reader (storage-handlers.mjs):
//   - GET reads res.arrayBuffer() (text() fallback) then checks res.ok; on !ok it throws
//     e.statusCode=res.status, e.body=text, e.message=`s3 GET <path> -> <status>: <body…>`.
//   - HEAD reads no body but still checks res.ok.
function stubFetch({ status, body }) {
  const bytes = Buffer.from(body ?? '', 'utf8');
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => String(body ?? '')
  });
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

// ---------------------------------------------------------------------------
// bbx-stor-nf-01: missing-object DOWNLOAD → clean 404 OBJECT_NOT_FOUND, no internals
// ---------------------------------------------------------------------------
test('bbx-stor-nf-01: storageGetObject on a missing object → 404 OBJECT_NOT_FOUND, no backend payload', async () => {
  await withFetch(stubFetch({ status: 404, body: NO_SUCH_KEY_XML }), async () => {
    const ctx = { params: { bucketId: 'b1', objectKey: 'missing.txt' }, identity: owner, query: {}, body: {}, pool: ownedBucketPool };
    const res = await storageGetObject(ctx);
    assert.equal(res.statusCode, 404, `expected 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'OBJECT_NOT_FOUND', `expected OBJECT_NOT_FOUND, got ${res.body.code}`);
    assertNoLeak(res.body.message);
    // The old leaked code string must also be gone from the body entirely.
    assert.ok(!JSON.stringify(res.body).includes('STORAGE_GET_FAILED'), 'must not surface STORAGE_GET_FAILED for a missing object');
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-nf-02: missing-object METADATA → clean 404 OBJECT_NOT_FOUND, no internals
// ---------------------------------------------------------------------------
test('bbx-stor-nf-02: storageObjectMetadata on a missing object → 404 OBJECT_NOT_FOUND, no backend payload', async () => {
  // The real HEAD response for a missing object has an empty body; the handler's 404 mapping must
  // not depend on the body content.
  await withFetch(stubFetch({ status: 404, body: '' }), async () => {
    const ctx = { params: { bucketId: 'b1', objectKey: 'missing.txt' }, identity: owner, query: {}, body: {}, pool: ownedBucketPool };
    const res = await storageObjectMetadata(ctx);
    assert.equal(res.statusCode, 404, `expected 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'OBJECT_NOT_FOUND', `expected OBJECT_NOT_FOUND, got ${res.body.code}`);
    assertNoLeak(res.body.message);
    assert.ok(!JSON.stringify(res.body).includes('STORAGE_HEAD_FAILED'), 'must not surface STORAGE_HEAD_FAILED for a missing object');
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-nf-03: the message is the exact canonical stable taxonomy message
// ---------------------------------------------------------------------------
test('bbx-stor-nf-03: missing-object 404 carries the canonical stable message', async () => {
  await withFetch(stubFetch({ status: 404, body: NO_SUCH_KEY_XML }), async () => {
    const ctx = { params: { bucketId: 'b1', objectKey: 'missing.txt' }, identity: owner, query: {}, body: {}, pool: ownedBucketPool };
    const res = await storageGetObject(ctx);
    assert.equal(res.body.message, 'The requested storage object was not found.');
  });
});

// ---------------------------------------------------------------------------
// bbx-stor-nf-04: a NON-404 backend failure also does NOT leak the raw payload
// ---------------------------------------------------------------------------
test('bbx-stor-nf-04: a 5xx backend failure keeps STORAGE_GET_FAILED but leaks no raw S3 payload', async () => {
  const INTERNAL_ERROR_XML = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>boom</Message><Resource>/ws-1a2b3c4d5e6f-assets/x.txt</Resource><RequestId>DEADBEEF</RequestId></Error>`;
  await withFetch(stubFetch({ status: 500, body: INTERNAL_ERROR_XML }), async () => {
    const ctx = { params: { bucketId: 'b1', objectKey: 'x.txt' }, identity: owner, query: {}, body: {}, pool: ownedBucketPool };
    const res = await storageGetObject(ctx);
    assert.equal(res.statusCode, 502, `a 5xx backend error maps to 502, got ${res.statusCode}`);
    assert.equal(res.body.code, 'STORAGE_GET_FAILED');
    assertNoLeak(res.body.message);
  });
});
