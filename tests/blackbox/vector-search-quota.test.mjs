// Black-box test suite for change add-vector-search — vector quota dimensions:
// snapshot calculation + insert (429) / DDL (422) enforcement. Drives the PUBLIC
// metering surface only:
//   packages/provisioning-orchestrator/src/repositories/vector-consumption-repository.mjs
//
// Tests: bbx-vec-quota-01 .. bbx-vec-quota-08
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VECTOR_QUOTA_DIMENSIONS,
  computeVectorConsumption,
  enforceVectorInsertQuota,
  enforceVectorDimensionQuota,
} from '../../packages/provisioning-orchestrator/src/repositories/vector-consumption-repository.mjs';

// bbx-vec-quota-01: the three vector quota dimensions are declared.
test('bbx-vec-quota-01: vector quota dimension keys are declared', () => {
  assert.ok(VECTOR_QUOTA_DIMENSIONS.includes('vector_row_count'));
  assert.ok(VECTOR_QUOTA_DIMENSIONS.includes('max_vector_dimension'));
  assert.ok(VECTOR_QUOTA_DIMENSIONS.includes('vector_index_memory_mb'));
});

// bbx-vec-quota-02: snapshot for a tenant WITH vector columns includes non-null values.
test('bbx-vec-quota-02: consumption snapshot includes vector dimensions for a tenant with vectors', async () => {
  // In-memory store fixture: collections describe vector columns; rows describe data.
  const store = {
    vectorColumns: [
      { tenant_id: 'ten_a', schema_name: 'public', table_name: 'docs', column_name: 'embedding', dimension: 1536, index_method: 'hnsw' },
    ],
    vectorRows: [
      { tenant_id: 'ten_a', schema_name: 'public', table_name: 'docs', column_name: 'embedding' },
      { tenant_id: 'ten_a', schema_name: 'public', table_name: 'docs', column_name: 'embedding' },
      { tenant_id: 'ten_b', schema_name: 'public', table_name: 'docs', column_name: 'embedding' },
    ],
  };
  const snap = await computeVectorConsumption(store, 'ten_a');
  assert.equal(snap.vector_row_count, 2, 'counts only tenant A vector rows');
  assert.equal(snap.max_vector_dimension, 1536);
  assert.equal(typeof snap.vector_index_memory_mb, 'number');
  assert.ok(snap.vector_index_memory_mb >= 0);
});

// bbx-vec-quota-03: tenant with NO vector columns gets zero values.
test('bbx-vec-quota-03: tenant with no vector columns has zero vector quota values', async () => {
  const store = { vectorColumns: [], vectorRows: [] };
  const snap = await computeVectorConsumption(store, 'ten_a');
  assert.equal(snap.vector_row_count, 0);
  assert.equal(snap.max_vector_dimension, 0);
  assert.equal(snap.vector_index_memory_mb, 0);
});

// bbx-vec-quota-04: insert is rejected with 429 when vector_row_count reaches the limit.
test('bbx-vec-quota-04: vector insert is rejected with 429 when row count quota is exceeded', () => {
  assert.throws(
    () => enforceVectorInsertQuota({ currentRowCount: 100, limit: 100, addingRows: 1 }),
    (e) => e.statusCode === 429 && /vector_row_count/.test(e.message),
  );
});

// bbx-vec-quota-05: insert is allowed when below the limit.
test('bbx-vec-quota-05: vector insert is allowed when below the row count quota', () => {
  assert.doesNotThrow(() => enforceVectorInsertQuota({ currentRowCount: 50, limit: 100, addingRows: 1 }));
});

// bbx-vec-quota-06: unlimited (-1) limit never blocks.
test('bbx-vec-quota-06: unlimited (-1) row count quota never blocks an insert', () => {
  assert.doesNotThrow(() => enforceVectorInsertQuota({ currentRowCount: 1e9, limit: -1, addingRows: 1 }));
});

// bbx-vec-quota-07: DDL is rejected with 422 when dimension exceeds max_vector_dimension.
test('bbx-vec-quota-07: column DDL is rejected with 422 when dimension exceeds the quota', () => {
  assert.throws(
    () => enforceVectorDimensionQuota({ dimension: 8192, maxDimension: 4096 }),
    (e) => e.statusCode === 422 && /max_vector_dimension/.test(e.message),
  );
});

// bbx-vec-quota-08: DDL is allowed when dimension is within the quota.
test('bbx-vec-quota-08: column DDL is allowed when dimension is within the quota', () => {
  assert.doesNotThrow(() => enforceVectorDimensionQuota({ dimension: 1536, maxDimension: 4096 }));
  // -1 means unlimited.
  assert.doesNotThrow(() => enforceVectorDimensionQuota({ dimension: 16000, maxDimension: -1 }));
});
