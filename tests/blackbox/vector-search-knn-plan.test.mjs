// Black-box test suite for change add-vector-search — data-API KNN plan builder.
// Drives the PUBLIC adapter surface only (buildPostgresDataApiPlan + exported
// operation/capability tables) — no internal knowledge of plan internals beyond the
// documented spec contract (SQL shape, distance operator, RLS clause, topK).
//
// Tests: bbx-vec-knn-01 .. bbx-vec-knn-10
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPostgresDataApiPlan,
  POSTGRES_DATA_API_OPERATIONS,
  POSTGRES_DATA_API_CAPABILITIES,
  POSTGRES_DATA_FILTER_OPERATORS,
} from '../../services/adapters/src/postgresql-data-api.mjs';

// A collection schema with a tenant column + a vector(3) column. Mirrors the
// executor's introspection shape: columns:[{columnName,dataType}], primaryKey:[...].
function vectorTable(overrides = {}) {
  return {
    schemaName: 'public',
    tableName: 'docs',
    columns: [
      { columnName: 'id', dataType: 'uuid', primaryKey: true },
      { columnName: 'tenant_id', dataType: 'text' },
      { columnName: 'category', dataType: 'text' },
      { columnName: 'embedding', dataType: 'vector(3)' },
    ],
    primaryKey: ['id'],
    ...overrides,
  };
}

function knnRequest(overrides = {}) {
  return {
    operation: 'knn_search',
    workspaceId: 'ws_a',
    databaseName: 'appdb',
    schemaName: 'public',
    tableName: 'docs',
    table: vectorTable(),
    actorRoleName: 'falcone_app',
    effectiveRoles: ['falcone_app'],
    tenantId: 'ten_a',
    sessionContext: { tenantId: 'ten_a', workspaceId: 'ws_a' },
    tableSecurity: { rlsEnabled: true },
    schemaGrants: [{ granteeRoleName: 'falcone_app', target: { schemaName: 'public' }, privileges: ['usage'] }],
    objectGrants: [
      { granteeRoleName: 'falcone_app', target: { schemaName: 'public', objectName: 'docs' }, privileges: ['select'] },
    ],
    policies: [
      {
        policyName: 'docs_tenant_isolation',
        appliesTo: { command: 'all', roles: ['public'] },
        runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenant_id' },
      },
    ],
    queryVector: [0.1, 0.2, 0.3],
    topK: 10,
    metric: 'cosine',
    ...overrides,
  };
}

// bbx-vec-knn-01: knn_search is a recognised operation + capability.
test('bbx-vec-knn-01: knn_search is registered as an operation and has a capability', () => {
  assert.ok(POSTGRES_DATA_API_OPERATIONS.includes('knn_search'), 'knn_search in operations table');
  assert.ok(POSTGRES_DATA_API_CAPABILITIES.knn_search, 'knn_search has a capability key');
});

// bbx-vec-knn-02: basic KNN plan SQL shape — SELECT ... ORDER BY <distance> LIMIT k.
test('bbx-vec-knn-02: KNN plan emits ORDER BY distance LIMIT topK with a distance projection', () => {
  const plan = buildPostgresDataApiPlan(knnRequest());
  assert.equal(plan.operation, 'knn_search');
  assert.equal(plan.capability, POSTGRES_DATA_API_CAPABILITIES.knn_search);
  const text = plan.sql.text;
  assert.match(text, /ORDER BY/i);
  assert.match(text, /LIMIT 10/);
  assert.match(text, /AS\s+"?distance"?/i, 'distance is projected');
  // The query vector is a bound parameter, not interpolated.
  assert.ok(plan.sql.values.some((v) => Array.isArray(v) || (typeof v === 'string' && v.includes('0.1'))), 'query vector bound as a value');
});

// bbx-vec-knn-03: cosine metric maps to the <=> operator.
test('bbx-vec-knn-03: cosine metric maps to <=>', () => {
  const plan = buildPostgresDataApiPlan(knnRequest({ metric: 'cosine' }));
  assert.match(plan.sql.text, /<=>/);
});

// bbx-vec-knn-04: l2 metric maps to the <-> operator.
test('bbx-vec-knn-04: l2 metric maps to <->', () => {
  const plan = buildPostgresDataApiPlan(knnRequest({ metric: 'l2' }));
  assert.match(plan.sql.text, /<->/);
});

// bbx-vec-knn-05: inner_product metric maps to the <#> operator.
test('bbx-vec-knn-05: inner_product metric maps to <#>', () => {
  const plan = buildPostgresDataApiPlan(knnRequest({ metric: 'inner_product' }));
  assert.match(plan.sql.text, /<#>/);
});

// bbx-vec-knn-06: omitting metric defaults to cosine (<=>).
test('bbx-vec-knn-06: omitted metric defaults to cosine', () => {
  const plan = buildPostgresDataApiPlan(knnRequest({ metric: undefined }));
  assert.match(plan.sql.text, /<=>/);
});

// bbx-vec-knn-07: unknown metric is rejected before any SQL.
test('bbx-vec-knn-07: unknown metric is rejected', () => {
  assert.throws(() => buildPostgresDataApiPlan(knnRequest({ metric: 'hamming' })), /metric/i);
});

// bbx-vec-knn-08: hybrid filter combines the RLS clause + scalar filter + distance order.
test('bbx-vec-knn-08: hybrid KNN applies a scalar filter via the existing filter operators', () => {
  // Use only operators from the existing POSTGRES_DATA_FILTER_OPERATORS table.
  assert.ok(POSTGRES_DATA_FILTER_OPERATORS.includes('eq'));
  const plan = buildPostgresDataApiPlan(
    knnRequest({ filter: [{ columnName: 'category', operator: 'eq', value: 'news' }] }),
  );
  const text = plan.sql.text;
  assert.match(text, /WHERE/i);
  assert.match(text, /"category"\s*=\s*\$\d/i, 'scalar filter predicate present');
  assert.match(text, /ORDER BY/i);
  // RLS clause binds tenant_id from session.
  assert.match(text, /"tenant_id"\s*=\s*\$\d/i, 'RLS tenant predicate present');
  assert.ok(plan.sql.values.includes('news'), 'filter value bound');
  assert.ok(plan.sql.values.includes('ten_a'), 'tenant value bound');
});

// bbx-vec-knn-09: neither queryVector nor queryText → rejected (one is required).
test('bbx-vec-knn-09: missing queryVector and queryText is rejected', () => {
  assert.throws(
    () => buildPostgresDataApiPlan(knnRequest({ queryVector: undefined, queryText: undefined })),
    /queryVector|queryText|required/i,
  );
});

// bbx-vec-knn-10: knn_search on a collection without a vector column → rejected.
test('bbx-vec-knn-10: knn_search on a collection without a vector column is rejected', () => {
  const noVector = vectorTable({
    columns: [
      { columnName: 'id', dataType: 'uuid', primaryKey: true },
      { columnName: 'tenant_id', dataType: 'text' },
      { columnName: 'category', dataType: 'text' },
    ],
  });
  assert.throws(
    () => buildPostgresDataApiPlan(knnRequest({ table: noVector })),
    /vector/i,
  );
});

// bbx-vec-knn-11: explicit vectorColumn selection is honoured and topK defaults to 10.
test('bbx-vec-knn-11: topK defaults to 10 when omitted', () => {
  const plan = buildPostgresDataApiPlan(knnRequest({ topK: undefined }));
  assert.match(plan.sql.text, /LIMIT 10/);
});
