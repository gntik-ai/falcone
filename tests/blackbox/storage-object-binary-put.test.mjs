// Black-box tests for change fix-storage-object-binary-put (#554).
//
// PUT /v1/storage/buckets/{b}/objects/{key} accepted ONLY the JSON envelope `{content,contentType}`;
// a raw/binary body was rejected by the server's JSON parse with 400 INVALID_JSON, so arbitrary
// (binary) objects could not be stored faithfully — not S3-PUT compatible.
//
// The fix: the kind server keeps the exact request bytes for any non-JSON content-type (ctx.rawBody),
// and `resolveObjectBody` stores them byte-for-byte; a JSON envelope may also carry binary via
// encoding:'base64'. Download returns contentBase64 so the bytes round-trip identically.
//
// Pure: imports the exported binding helper; no network, no real SeaweedFS (the existing
// storage-object-io-routes test already proves the routes are wired).
//
// bbx-storage-bin-01 .. bbx-storage-bin-05
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveObjectBody } from '../../apps/control-plane/storage-handlers.mjs';

// Non-UTF-8 bytes (PNG magic + control/high bytes) — a faithful binary payload.
const BIN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xff, 0xfe, 0x7f, 0x80]);

test('bbx-storage-bin-01: a raw/binary request body is stored byte-for-byte with its content-type', () => {
  const { bytes, contentType } = resolveObjectBody({ rawBodyIsBinary: true, rawBody: BIN, contentType: 'image/png' });
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual([...bytes], [...BIN], 'exact bytes preserved');
  assert.equal(contentType, 'image/png');
});

test('bbx-storage-bin-02: a JSON envelope with encoding:base64 decodes to the exact bytes', () => {
  const { bytes, contentType } = resolveObjectBody({ body: { content: BIN.toString('base64'), encoding: 'base64', contentType: 'application/octet-stream' } });
  assert.deepEqual([...bytes], [...BIN], 'base64 envelope decodes byte-identically');
  assert.equal(contentType, 'application/octet-stream');
});

test('bbx-storage-bin-03: a legacy text JSON envelope still stores UTF-8 content', () => {
  const { bytes, contentType } = resolveObjectBody({ body: { content: 'hello world', contentType: 'text/plain' } });
  assert.equal(bytes.toString('utf8'), 'hello world');
  assert.equal(contentType, 'text/plain');
});

test('bbx-storage-bin-04: raw upload with no content-type defaults to application/octet-stream', () => {
  const { contentType } = resolveObjectBody({ rawBodyIsBinary: true, rawBody: BIN, contentType: '' });
  assert.equal(contentType, 'application/octet-stream');
});

test('bbx-storage-bin-05: byte-identical round-trip (raw PUT bytes -> base64 GET -> decode)', () => {
  // PUT side resolves the exact bytes; GET side emits contentBase64 = bytes.toString("base64").
  const { bytes } = resolveObjectBody({ rawBodyIsBinary: true, rawBody: BIN, contentType: 'application/octet-stream' });
  const contentBase64 = bytes.toString('base64');             // what storageGetObject returns
  const roundTripped = Buffer.from(contentBase64, 'base64');  // what a client reconstructs
  assert.deepEqual([...roundTripped], [...BIN], 'binary round-trips byte-identically');
});
