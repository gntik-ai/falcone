// Unit test for change add-write-time-auto-embedding — the in-memory mapping store seam.
//
// createEmbeddingMappingStore() with NO pool is the test/single-process fallback (mirrors
// createEmbeddingProviderStore()). This proves the deploy/get/remove/warning cycle and that
// ensureSchema() is a no-op (never touches a DB).
//
// Tests: unit-mapping-01 .. unit-mapping-06
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmbeddingMappingStore,
  REMAPPING_WARNING,
} from '../../apps/control-plane/src/runtime/embedding-executor.mjs';

const WS = 'ws_unit';
const TEN = 'ten_unit';
const base = { tenantId: TEN, schemaName: 'public', tableName: 'docs', targetColumn: 'embedding' };

// unit-mapping-01: ensureSchema() is a no-op with no pool (does not throw, no DB).
test('unit-mapping-01: ensureSchema() is a no-op for the in-memory store', async () => {
  const store = createEmbeddingMappingStore();
  await store.ensureSchema(); // must not throw
});

// unit-mapping-02: deployMapping then getMapping round-trips the record.
test('unit-mapping-02: deployMapping + getMapping round-trip', async () => {
  const store = createEmbeddingMappingStore();
  const rec = await store.deployMapping(WS, { ...base, sourceColumn: 'body' });
  assert.equal(rec.sourceColumn, 'body');
  assert.equal(rec.targetColumn, 'embedding');
  const got = await store.getMapping(WS, base);
  assert.ok(got);
  assert.equal(got.sourceColumn, 'body');
  assert.equal(got.targetColumn, 'embedding');
  assert.equal(got.schemaName, 'public');
  assert.equal(got.tableName, 'docs');
});

// unit-mapping-03: getMappings returns the table's rule(s) (table-scoped lookup).
test('unit-mapping-03: getMappings returns the rules for a table', async () => {
  const store = createEmbeddingMappingStore();
  await store.deployMapping(WS, { ...base, sourceColumn: 'body' });
  await store.deployMapping(WS, { ...base, targetColumn: 'title_embedding', sourceColumn: 'title' });
  const rules = await store.getMappings(WS, { tenantId: TEN, schemaName: 'public', tableName: 'docs' });
  assert.equal(rules.length, 2, 'both vector columns mapped');
  const byTarget = Object.fromEntries(rules.map((r) => [r.targetColumn, r.sourceColumn]));
  assert.equal(byTarget.embedding, 'body');
  assert.equal(byTarget.title_embedding, 'title');
});

// unit-mapping-04: replacing an existing mapping returns a remapping warning.
test('unit-mapping-04: replacing a mapping returns a remapping warning', async () => {
  const store = createEmbeddingMappingStore();
  const first = await store.deployMapping(WS, { ...base, sourceColumn: 'body' });
  assert.equal(first.warning, undefined, 'first deploy has no warning');
  const second = await store.deployMapping(WS, { ...base, sourceColumn: 'summary' });
  assert.ok(second.warning, 'replacement surfaces a warning');
  assert.equal(second.warning, REMAPPING_WARNING);
  assert.equal(second.sourceColumn, 'summary', 'mapping updated to the new source');
});

// unit-mapping-05: removeMapping deletes; subsequent getMapping returns null.
test('unit-mapping-05: removeMapping deletes the record', async () => {
  const store = createEmbeddingMappingStore();
  await store.deployMapping(WS, { ...base, sourceColumn: 'body' });
  assert.deepEqual(await store.removeMapping(WS, base), { removed: true });
  assert.equal(await store.getMapping(WS, base), null);
  assert.deepEqual(await store.removeMapping(WS, base), { removed: false }, 'removing an absent mapping returns removed:false');
});

// unit-mapping-06: mappings are scoped by tenant — same workspaceId, different tenant, isolated.
test('unit-mapping-06: mappings are tenant-scoped (no cross-tenant leakage)', async () => {
  const store = createEmbeddingMappingStore();
  await store.deployMapping(WS, { ...base, tenantId: 'ten_x', sourceColumn: 'body' });
  await store.deployMapping(WS, { ...base, tenantId: 'ten_y', sourceColumn: 'title' });
  const x = await store.getMapping(WS, { ...base, tenantId: 'ten_x' });
  const y = await store.getMapping(WS, { ...base, tenantId: 'ten_y' });
  assert.equal(x.sourceColumn, 'body');
  assert.equal(y.sourceColumn, 'title');
  // Tenant x removing its mapping must not affect tenant y.
  await store.removeMapping(WS, { ...base, tenantId: 'ten_x' });
  assert.equal(await store.getMapping(WS, { ...base, tenantId: 'ten_x' }), null);
  assert.ok(await store.getMapping(WS, { ...base, tenantId: 'ten_y' }), 'tenant y mapping survives');
});
