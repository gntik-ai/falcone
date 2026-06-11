// Black-box test suite for change add-vector-search — vector column + index DDL and
// the pgvector governance placement gate. Drives the PUBLIC adapter surface only:
//   - postgresql-structural-admin: vector(N) column + HNSW/IVFFlat index
//   - postgresql-governance-admin: extension placement gate
//
// Tests: bbx-vec-ddl-01 .. bbx-vec-ddl-11, bbx-vec-gov-01 .. bbx-vec-gov-03
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPostgresStructuralSqlPlan,
  validatePostgresStructuralRequest,
  buildAllowedPostgresTypeCatalog,
} from '../../services/adapters/src/postgresql-structural-admin.mjs';
import {
  validatePostgresGovernanceRequest,
  buildPostgresGovernanceSqlPlan,
} from '../../services/adapters/src/postgresql-governance-admin.mjs';

// A type catalog with pgvector enabled (mirrors a dedicated-DB tenant that enabled it).
const VECTOR_CATALOG = buildAllowedPostgresTypeCatalog({
  enabledExtensions: ['vector'],
  extensionTypes: [{ schemaName: 'public', typeName: 'vector', extensionName: 'vector', kind: 'scalar', typeClass: 'base' }],
});

function columnReq(payload) {
  return {
    resourceKind: 'column',
    action: 'create',
    context: { databaseName: 'appdb', schemaName: 'public', tableName: 'docs', allowedTypeCatalog: VECTOR_CATALOG },
    payload: { databaseName: 'appdb', schemaName: 'public', tableName: 'docs', ...payload },
  };
}

function indexReq(payload, currentTable) {
  return {
    resourceKind: 'index',
    action: 'create',
    context: {
      databaseName: 'appdb',
      schemaName: 'public',
      tableName: 'docs',
      allowedTypeCatalog: VECTOR_CATALOG,
      currentTable: currentTable ?? {
        columns: [
          { columnName: 'id', dataType: { typeName: 'uuid' } },
          { columnName: 'embedding', dataType: { typeName: 'vector', precision: '3' } },
        ],
      },
    },
    payload: { databaseName: 'appdb', schemaName: 'public', tableName: 'docs', ...payload },
  };
}

// ---- Vector column DDL --------------------------------------------------------

// bbx-vec-ddl-01: vector column with a valid dimension renders vector(N).
test('bbx-vec-ddl-01: vector column with valid dimension renders ADD COLUMN ... vector(768)', () => {
  const plan = buildPostgresStructuralSqlPlan(columnReq({ columnName: 'embedding', dataType: 'vector', dimension: 768 }));
  assert.ok(plan.statements.some((s) => /ADD COLUMN "embedding" vector\(768\)/.test(s)), `got: ${JSON.stringify(plan.statements)}`);
});

// bbx-vec-ddl-02: vector column WITHOUT dimension is rejected before SQL.
test('bbx-vec-ddl-02: vector column without dimension is rejected', () => {
  const v = validatePostgresStructuralRequest(columnReq({ columnName: 'embedding', dataType: 'vector' }));
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((m) => /dimension/i.test(m)), `violations: ${JSON.stringify(v.violations)}`);
});

// bbx-vec-ddl-03: dimension = 0 (out of range) is rejected.
test('bbx-vec-ddl-03: vector column with dimension 0 is rejected', () => {
  const v = validatePostgresStructuralRequest(columnReq({ columnName: 'embedding', dataType: 'vector', dimension: 0 }));
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((m) => /dimension/i.test(m)));
});

// bbx-vec-ddl-04: dimension > 16000 (out of range) is rejected.
test('bbx-vec-ddl-04: vector column with dimension > 16000 is rejected', () => {
  const v = validatePostgresStructuralRequest(columnReq({ columnName: 'embedding', dataType: 'vector', dimension: 16001 }));
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((m) => /dimension/i.test(m)));
});

// bbx-vec-ddl-05: a valid vector column passes validation.
test('bbx-vec-ddl-05: vector column with dimension 1536 passes validation', () => {
  const v = validatePostgresStructuralRequest(columnReq({ columnName: 'embedding', dataType: 'vector', dimension: 1536 }));
  assert.equal(v.ok, true, `violations: ${JSON.stringify(v.violations)}`);
});

// ---- Vector index DDL ---------------------------------------------------------

// bbx-vec-ddl-06: default vector index → HNSW cosine.
test('bbx-vec-ddl-06: default vector index renders USING hnsw (... vector_cosine_ops)', () => {
  const plan = buildPostgresStructuralSqlPlan(
    indexReq({ indexName: 'docs_embedding_idx', indexMethod: 'hnsw', keys: [{ columnName: 'embedding' }] }),
  );
  assert.ok(
    plan.statements.some((s) => /USING HNSW \("embedding" vector_cosine_ops\)/i.test(s)),
    `got: ${JSON.stringify(plan.statements)}`,
  );
});

// bbx-vec-ddl-07: IVFFlat + L2.
test('bbx-vec-ddl-07: ivfflat l2 vector index renders vector_l2_ops', () => {
  const plan = buildPostgresStructuralSqlPlan(
    indexReq({ indexName: 'docs_embedding_idx', indexMethod: 'ivfflat', metric: 'l2', keys: [{ columnName: 'embedding' }] }),
  );
  assert.ok(
    plan.statements.some((s) => /USING IVFFLAT \("embedding" vector_l2_ops\)/i.test(s)),
    `got: ${JSON.stringify(plan.statements)}`,
  );
});

// bbx-vec-ddl-08: inner_product opclass.
test('bbx-vec-ddl-08: hnsw inner_product vector index renders vector_ip_ops', () => {
  const plan = buildPostgresStructuralSqlPlan(
    indexReq({ indexName: 'docs_embedding_idx', indexMethod: 'hnsw', metric: 'inner_product', keys: [{ columnName: 'embedding' }] }),
  );
  assert.ok(
    plan.statements.some((s) => /USING HNSW \("embedding" vector_ip_ops\)/i.test(s)),
    `got: ${JSON.stringify(plan.statements)}`,
  );
});

// bbx-vec-ddl-09: unsupported metric on a vector index is rejected.
test('bbx-vec-ddl-09: unsupported vector index metric is rejected', () => {
  const v = validatePostgresStructuralRequest(
    indexReq({ indexName: 'docs_embedding_idx', indexMethod: 'hnsw', metric: 'hamming', keys: [{ columnName: 'embedding' }] }),
  );
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((m) => /metric|hamming/i.test(m)), `violations: ${JSON.stringify(v.violations)}`);
});

// bbx-vec-ddl-10: a vector index on a NON-vector column is rejected.
test('bbx-vec-ddl-10: vector index on a non-vector column is rejected', () => {
  const v = validatePostgresStructuralRequest(
    indexReq(
      { indexName: 'docs_bad_idx', indexMethod: 'hnsw', keys: [{ columnName: 'id' }] },
      {
        columns: [
          { columnName: 'id', dataType: { typeName: 'uuid' } },
          { columnName: 'embedding', dataType: { typeName: 'vector', precision: '3' } },
        ],
      },
    ),
  );
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((m) => /vector/i.test(m)), `violations: ${JSON.stringify(v.violations)}`);
});

// bbx-vec-ddl-11: a btree index on a scalar column still works (no regression).
test('bbx-vec-ddl-11: btree index on a scalar column is unaffected', () => {
  const plan = buildPostgresStructuralSqlPlan(
    indexReq({ indexName: 'docs_id_idx', indexMethod: 'btree', keys: [{ columnName: 'id' }] }),
  );
  assert.ok(plan.statements.some((s) => /USING BTREE \("id"\)/i.test(s)), `got: ${JSON.stringify(plan.statements)}`);
});

// ---- Governance placement gate ------------------------------------------------

function govReq(placementMode) {
  return {
    resourceKind: 'extension',
    action: 'create',
    payload: { databaseName: 'appdb', extensionName: 'vector' },
    context: { databaseName: 'appdb', tenantId: 'ten_a', workspaceId: 'ws_a' },
    profile: { placementMode },
  };
}

// bbx-vec-gov-01: vector extension is accepted for database_per_tenant.
test('bbx-vec-gov-01: vector extension is accepted for database_per_tenant', () => {
  const v = validatePostgresGovernanceRequest(govReq('database_per_tenant'));
  assert.equal(v.ok, true, `violations: ${JSON.stringify(v.violations)}`);
  const plan = buildPostgresGovernanceSqlPlan({
    resourceKind: 'extension',
    action: 'create',
    payload: { databaseName: 'appdb', extensionName: 'vector' },
    context: { databaseName: 'appdb', tenantId: 'ten_a', workspaceId: 'ws_a', profile: { placementMode: 'database_per_tenant' } },
  });
  assert.ok(plan.statements.some((s) => /CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public"/.test(s)), `got: ${JSON.stringify(plan.statements)}`);
});

// bbx-vec-gov-02: vector extension is REJECTED for schema_per_tenant (HTTP 422 surface).
test('bbx-vec-gov-02: vector extension is rejected for schema_per_tenant', () => {
  const v = validatePostgresGovernanceRequest(govReq('schema_per_tenant'));
  assert.equal(v.ok, false);
  assert.ok(
    v.violations.some((m) => /vector/i.test(m) && /schema_per_tenant/i.test(m)),
    `violations: ${JSON.stringify(v.violations)}`,
  );
});

// bbx-vec-gov-03: rejection produces NO SQL plan (buildPostgresGovernanceSqlPlan throws).
test('bbx-vec-gov-03: schema_per_tenant vector enablement produces no SQL plan', () => {
  assert.throws(
    () =>
      buildPostgresGovernanceSqlPlan({
        resourceKind: 'extension',
        action: 'create',
        payload: { databaseName: 'appdb', extensionName: 'vector' },
        context: { databaseName: 'appdb', tenantId: 'ten_a', workspaceId: 'ws_a', profile: { placementMode: 'schema_per_tenant' } },
      }),
    (err) => err.validation && err.validation.ok === false,
  );
});
