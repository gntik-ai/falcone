// fix-mongo-document-id-objectid-coercion (#495): a document inserted without an explicit
// `_id` is stored with a BSON ObjectId, but the by-id handlers query `{_id: "<hex>"}` as a
// plain string, which never matches — so get/update/replace/delete by id silently no-op.
// `coerceDocumentIdFilter` widens a 24-hex `_id` to match EITHER the ObjectId or the string,
// while preserving the tenant predicate the adapter merged in and leaving non-ObjectId ids
// untouched (string fallback). Pure unit test — no Mongo driver connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { coerceDocumentIdFilter } from '../../apps/control-plane-executor/src/runtime/mongo-data-executor.mjs';

const HEX = 'a1b2c3d4e5f6a1b2c3d4e5f6'; // 24-char hex → valid ObjectId

test('a 24-hex _id is widened to match the ObjectId OR the raw string', () => {
  const out = coerceDocumentIdFilter({ tenantId: 'ten-a', _id: HEX });
  assert.equal(out.tenantId, 'ten-a', 'tenant predicate is preserved');
  assert.equal(out._id, undefined, 'the bare string _id is replaced by the $or');
  assert.ok(Array.isArray(out.$or) && out.$or.length === 2, 'matches both id forms');
  assert.ok(out.$or[0]._id instanceof ObjectId, 'first branch is a real ObjectId');
  assert.equal(out.$or[0]._id.toHexString(), HEX, 'ObjectId carries the requested hex');
  assert.equal(out.$or[1]._id, HEX, 'string fallback retained for custom hex-string ids');
});

test('rewrites the _id branch nested inside the adapter $and (real filter shape)', () => {
  // mergeFilters({tenantId}, {_id}) → {$and:[{tenantId},{_id}]} — the _id is NOT top-level.
  const out = coerceDocumentIdFilter({ $and: [{ tenantId: 'ten-a' }, { _id: HEX }] });
  assert.deepEqual(out.$and[0], { tenantId: 'ten-a' }, 'tenant clause untouched');
  assert.ok(Array.isArray(out.$and[1].$or), 'the _id clause became an $or');
  assert.ok(out.$and[1].$or[0]._id instanceof ObjectId);
  assert.equal(out.$and[1].$or[1]._id, HEX);
});

test('a non-ObjectId _id is left untouched (string fallback)', () => {
  const filter = { tenantId: 'ten-a', _id: 'a1' };
  assert.deepEqual(coerceDocumentIdFilter(filter), filter);
});

test('a filter without _id is returned unchanged', () => {
  const filter = { tenantId: 'ten-a', body: { $eq: 'x' } };
  assert.deepEqual(coerceDocumentIdFilter(filter), filter);
});

test('the tenant scope is never widened — only the _id match is', () => {
  // The $or wraps ONLY the _id, so the result is `tenantId=A AND (_id=oid OR _id=hex)`.
  const out = coerceDocumentIdFilter({ tenantId: 'ten-a', workspaceId: 'ws-a', _id: HEX });
  assert.equal(out.tenantId, 'ten-a');
  assert.equal(out.workspaceId, 'ws-a');
  assert.ok(out.$or.every((branch) => Object.keys(branch).length === 1 && '_id' in branch));
});

test('null / non-object filters pass through safely', () => {
  assert.equal(coerceDocumentIdFilter(null), null);
  assert.equal(coerceDocumentIdFilter(undefined), undefined);
});
