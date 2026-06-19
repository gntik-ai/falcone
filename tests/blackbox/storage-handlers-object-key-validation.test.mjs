// fix-storage-object-key-validation (#638)
//
// Distinct from storage-object-key-traversal.test.mjs, which covers the pure ADAPTER builder
// (services/adapters/.../assertObjectKey). This covers the LIVE kind REST path — the
// deploy/kind/control-plane storage handlers that talk to the real S3 backend over SigV4. That
// path did NOT validate the key, so a traversal probe reached the backend and surfaced as a 502.
// The handlers now validate/normalize the key BEFORE any backend/DB call and return 400. Pure: the
// pool/backend is never reached for a malformed key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_HANDLERS } from '../../deploy/kind/control-plane/storage-handlers.mjs';

// A pool whose query() throws — proves key validation runs BEFORE any DB/backend call.
const explodingPool = { query: async () => { throw new Error('pool must not be reached for a malformed key'); } };
const owner = { actorType: 'tenant_owner', tenantId: 'ten_1' };

const BAD_KEYS = [
  '..%2F..%2Fetc%2Fpasswd', // the reported repro: ../../etc/passwd
  '..%2F..%2F..%2Froot',
  '%2Fetc%2Fpasswd', // leading slash
  'a%2F..%2F..%2Fb', // mid-key traversal segment
  'uploads%5Cwin', // backslash
];

for (const handlerName of ['storageGetObject', 'storagePutObject', 'storageDeleteObject', 'storageObjectMetadata']) {
  test(`bbx-objkey-live-01: ${handlerName} rejects a malformed/traversal key with 400 (not 502), no backend call`, async () => {
    for (const objectKey of BAD_KEYS) {
      const ctx = { params: { bucketId: 'b1', objectKey }, identity: owner, query: {}, body: {}, pool: explodingPool };
      const res = await STORAGE_HANDLERS[handlerName](ctx);
      assert.equal(res.statusCode, 400, `${handlerName} ${objectKey} -> ${res.statusCode} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'INVALID_OBJECT_KEY');
    }
  });
}

test('bbx-objkey-live-02: malformed percent-encoding is a 400, not a 500', async () => {
  const ctx = { params: { bucketId: 'b1', objectKey: '%ZZ' }, identity: owner, query: {}, body: {}, pool: explodingPool };
  const res = await STORAGE_HANDLERS.storageGetObject(ctx);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_OBJECT_KEY');
});

test('bbx-objkey-live-03: a VALID nested key is NOT flagged as traversal (passes to the ownership gate)', async () => {
  // No bucket record -> the ownership gate returns 404 BUCKET_NOT_FOUND. The point: NOT a 400 key error.
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const ctx = { params: { bucketId: 'b1', objectKey: 'reports/2026/q2.csv' }, identity: owner, query: {}, body: {}, pool };
  const res = await STORAGE_HANDLERS.storageGetObject(ctx);
  assert.notEqual(res.body.code, 'INVALID_OBJECT_KEY', 'a legitimate nested key must not be rejected as traversal');
  assert.equal(res.statusCode, 404);
});
