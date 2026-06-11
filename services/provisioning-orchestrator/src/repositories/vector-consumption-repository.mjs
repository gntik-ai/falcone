// Vector quota dimensions (change: add-vector-search).
//
// Extends the metering subsystem (see consumption-repository.mjs / resolveDimensionCounts)
// with three per-tenant vector dimensions used for noisy-neighbor control:
//   - vector_row_count        total rows with a non-null vector value (this tenant)
//   - max_vector_dimension    largest declared vector(N) dimension in the tenant's DBs
//   - vector_index_memory_mb  estimated HNSW/IVFFlat index memory footprint
// A tenant with NO vector columns reports zeros for all three. Enforcement:
//   - insert into a vector collection at the vector_row_count limit -> HTTP 429
//   - declaring a vector column whose dimension exceeds max_vector_dimension -> HTTP 422
// (-1 means "unlimited" per the effective-limit convention used elsewhere.)

export const VECTOR_QUOTA_DIMENSIONS = Object.freeze([
  'vector_row_count',
  'max_vector_dimension',
  'vector_index_memory_mb'
]);

// HNSW memory grows ~ rows * (dimension * 4 bytes + per-node graph overhead). This is a
// coarse estimate (MB) used purely for quota accounting, not exact planner statistics.
const HNSW_NODE_OVERHEAD_BYTES = 64;
const FLOAT_BYTES = 4;

function matchesTenant(row, tenantId) {
  return (row.tenant_id ?? row.tenantId) === tenantId;
}

function rowDimension(row) {
  return Number(row.dimension ?? row.vector_dimension ?? row.precision ?? 0);
}

function estimateIndexMemoryMb(vectorColumns, rowsByColumnKey) {
  let totalBytes = 0;
  for (const column of vectorColumns) {
    const key = `${column.schema_name ?? column.schemaName}.${column.table_name ?? column.tableName}.${column.column_name ?? column.columnName}`;
    const rows = rowsByColumnKey.get(key) ?? 0;
    const dimension = rowDimension(column);
    if (rows === 0 || dimension === 0) continue;
    totalBytes += rows * (dimension * FLOAT_BYTES + HNSW_NODE_OVERHEAD_BYTES);
  }
  return Number((totalBytes / (1024 * 1024)).toFixed(3));
}

// Compute the tenant's vector consumption snapshot. `store` is either an in-memory
// fixture ({ vectorColumns:[...], vectorRows:[...] }) or a pg client exposing the same
// data via queries. The in-memory shape keeps this unit-testable without a live DB.
export async function computeVectorConsumption(store, tenantId) {
  let vectorColumns;
  let vectorRows;

  if (Array.isArray(store?.vectorColumns) || Array.isArray(store?.vectorRows)) {
    vectorColumns = (store.vectorColumns ?? []).filter((row) => matchesTenant(row, tenantId));
    vectorRows = (store.vectorRows ?? []).filter((row) => matchesTenant(row, tenantId));
  } else if (typeof store?.query === 'function') {
    const cols = await store.query(
      `SELECT schema_name, table_name, column_name, dimension
         FROM vector_column_catalog WHERE tenant_id = $1`,
      [tenantId]
    );
    vectorColumns = cols.rows ?? cols ?? [];
    const rows = await store.query(
      `SELECT schema_name, table_name, column_name, COUNT(*)::bigint AS row_count
         FROM vector_row_inventory WHERE tenant_id = $1
        GROUP BY schema_name, table_name, column_name`,
      [tenantId]
    );
    // Flatten count rows into per-row entries semantics handled below.
    const flat = [];
    for (const r of rows.rows ?? rows ?? []) {
      for (let i = 0; i < Number(r.row_count ?? 0); i += 1) {
        flat.push({ schema_name: r.schema_name, table_name: r.table_name, column_name: r.column_name });
      }
    }
    vectorRows = flat;
  } else {
    vectorColumns = [];
    vectorRows = [];
  }

  if (vectorColumns.length === 0) {
    return { vector_row_count: 0, max_vector_dimension: 0, vector_index_memory_mb: 0 };
  }

  const rowsByColumnKey = new Map();
  for (const row of vectorRows) {
    const key = `${row.schema_name ?? row.schemaName}.${row.table_name ?? row.tableName}.${row.column_name ?? row.columnName}`;
    rowsByColumnKey.set(key, (rowsByColumnKey.get(key) ?? 0) + 1);
  }

  const maxVectorDimension = vectorColumns.reduce((max, column) => Math.max(max, rowDimension(column)), 0);
  return {
    vector_row_count: vectorRows.length,
    max_vector_dimension: maxVectorDimension,
    vector_index_memory_mb: estimateIndexMemoryMb(vectorColumns, rowsByColumnKey)
  };
}

// Enforce the vector_row_count quota on inserts. Throws a 429 client error citing the
// exceeded dimension when adding the rows would reach/exceed the limit. -1 = unlimited.
export function enforceVectorInsertQuota({ currentRowCount = 0, limit, addingRows = 1 } = {}) {
  if (limit === undefined || limit === null || Number(limit) === -1) return;
  if (Number(currentRowCount) + Number(addingRows) > Number(limit)) {
    throw Object.assign(new Error('Quota dimension vector_row_count exceeded'), {
      statusCode: 429,
      code: 'VECTOR_ROW_COUNT_EXCEEDED',
      dimension: 'vector_row_count'
    });
  }
}

// Enforce the max_vector_dimension quota at vector-column DDL time. Throws a 422 client
// error before any SQL when the requested dimension exceeds the limit. -1 = unlimited.
export function enforceVectorDimensionQuota({ dimension, maxDimension } = {}) {
  if (maxDimension === undefined || maxDimension === null || Number(maxDimension) === -1) return;
  if (Number(dimension) > Number(maxDimension)) {
    throw Object.assign(new Error('Quota dimension max_vector_dimension exceeded'), {
      statusCode: 422,
      code: 'MAX_VECTOR_DIMENSION_EXCEEDED',
      dimension: 'max_vector_dimension'
    });
  }
}
