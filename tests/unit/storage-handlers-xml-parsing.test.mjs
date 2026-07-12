// XML parsing hardening for the live storage runtime (apps/control-plane/storage-handlers.mjs).
//
// listBuckets() / listObjects() parse the S3 ListAllMyBucketsResult / ListBucketResult
// envelopes with an entity-aware, CDATA-tolerant regex parser. These tests stub the
// global fetch the module uses (no real S3) and assert:
//   1. backward-compat: the REAL SeaweedFS 4.33 envelopes captured in the adr-spike still
//      parse correctly (including &#34;-quoted ETags and NextContinuationToken pagination);
//   2. entity-encoded bucket names decode correctly (task 7.2);
//   3. object keys with slashes and &amp; decode correctly with size/etag/lastModified (task 7.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SPIKE = new URL('../../spikes/add-seaweedfs-storage-adr-spike/evidence/', import.meta.url);
const realListBuckets = readFileSync(new URL('03-listbuckets.xml', SPIKE), 'utf8');
const realListObjects = readFileSync(new URL('04-listobjectsv2.xml', SPIKE), 'utf8');

// Import once; the module reads the global fetch lazily inside each call.
const handlers = await import('../../apps/control-plane/storage-handlers.mjs');

function withStubbedFetch(textByKind, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const isListObjects = String(url).includes('list-type');
    const text = isListObjects ? textByKind.listObjects : textByKind.listBuckets;
    return { ok: true, status: 200, headers: new Map(), text: async () => text };
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = original; });
}

test('listBuckets parses the real SeaweedFS 4.33 ListAllMyBucketsResult envelope', async () => {
  await withStubbedFetch({ listBuckets: realListBuckets }, async () => {
    const buckets = await handlers.listBuckets();
    assert.deepEqual(buckets.map((b) => b.name), ['tenant-a-bucket', 'tenant-a-lock-bucket']);
    assert.equal(buckets[0].creationDate, '2026-06-14T00:20:26Z');
  });
});

test('listObjects parses the real SeaweedFS 4.33 ListBucketResult envelope (incl. &#34; ETag quotes)', async () => {
  await withStubbedFetch({ listObjects: realListObjects }, async () => {
    const { objects, nextToken } = await handlers.listObjects('tenant-a-bucket', { maxKeys: 50 });
    assert.deepEqual(objects.map((o) => o.key), ['byTenantA.txt', 'probe/hello.txt', 'ver/obj.txt']);
    assert.equal(objects[0].size, 18);
    assert.equal(objects[0].etag, '0ed1ec84951e84b4e5145543715359b5');
    assert.equal(objects[1].lastModified, '2026-06-14T00:20:26Z');
    assert.equal(nextToken, null);
  });
});

test('listBuckets decodes an entity-encoded bucket name (task 7.2)', async () => {
  const listBuckets = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>admin</ID><DisplayName>admin</DisplayName></Owner><Buckets><Bucket><Name>tenant-a&amp;b_bucket</Name><CreationDate>2026-06-14T00:20:26Z</CreationDate></Bucket><Bucket><Name><![CDATA[cdata-bucket]]></Name><CreationDate>2026-06-14T00:21:00Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>`;
  await withStubbedFetch({ listBuckets }, async () => {
    const buckets = await handlers.listBuckets();
    assert.deepEqual(buckets.map((b) => b.name), ['tenant-a&b_bucket', 'cdata-bucket']);
  });
});

test('listObjects decodes a key with a slash and &amp; (task 7.3)', async () => {
  const listObjects = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>tenant-a-bucket</Name><Prefix></Prefix><MaxKeys>50</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>reports/2026/Q1&amp;Q2.csv</Key><ETag>&#34;deadbeefdeadbeefdeadbeefdeadbeef&#34;</ETag><Size>4096</Size><StorageClass>STANDARD</StorageClass><LastModified>2026-06-14T01:00:00Z</LastModified></Contents><KeyCount>1</KeyCount></ListBucketResult>`;
  await withStubbedFetch({ listObjects }, async () => {
    const { objects } = await handlers.listObjects('tenant-a-bucket', { maxKeys: 50 });
    assert.equal(objects.length, 1);
    assert.equal(objects[0].key, 'reports/2026/Q1&Q2.csv');
    assert.equal(objects[0].size, 4096);
    assert.equal(objects[0].etag, 'deadbeefdeadbeefdeadbeefdeadbeef');
    assert.equal(objects[0].lastModified, '2026-06-14T01:00:00Z');
    assert.equal(objects[0].storageClass, 'STANDARD');
  });
});

test('listObjects surfaces NextContinuationToken when truncated', async () => {
  const listObjects = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>tenant-a-bucket</Name><Prefix></Prefix><MaxKeys>1</MaxKeys><IsTruncated>true</IsTruncated><Contents><Key>a.txt</Key><ETag>&#34;aaaa&#34;</ETag><Size>1</Size><StorageClass>STANDARD</StorageClass><LastModified>2026-06-14T01:00:00Z</LastModified></Contents><NextContinuationToken>TOKEN-2</NextContinuationToken><KeyCount>1</KeyCount></ListBucketResult>`;
  await withStubbedFetch({ listObjects }, async () => {
    const { objects, nextToken } = await handlers.listObjects('tenant-a-bucket', { maxKeys: 1 });
    assert.equal(objects.length, 1);
    assert.equal(nextToken, 'TOKEN-2');
  });
});
