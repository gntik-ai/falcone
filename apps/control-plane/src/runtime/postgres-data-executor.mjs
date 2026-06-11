// PostgreSQL data-API executor (change: add-control-plane-executor).
//
// This is the "executor over the existing adapter plans" seam: it takes a data-API
// request, asks the (spec-only) adapter to BUILD the SQL plan
// (services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan), then
// actually EXECUTES that plan against the workspace's real Postgres via the
// connection registry — closing the gap where the product had a full PostgREST-style
// surface that never ran. Tenant isolation is enforced two ways: the adapter injects
// a session-scoped row predicate into the SQL, and the query runs under the
// per-workspace RLS context (app.tenant_id/app.workspace_id) as a non-superuser role.
import { buildPostgresDataApiPlan, serializePostgresDataApiCursor } from '../../../../services/adapters/src/postgresql-data-api.mjs';
import { clientError, mapPgError } from './errors.mjs';

const DEFAULT_DATA_ROLE = 'falcone_app';
const TENANT_COLUMN = 'tenant_id';
const WORKSPACE_COLUMN = 'workspace_id';

// Introspect a table into the shape buildPostgresDataApiPlan expects:
// { schemaName, tableName, columns:[{columnName,dataType}], primaryKey:[...] }.
export async function introspectTable(client, schemaName, tableName) {
  // udt_name is needed to recognise pgvector columns: information_schema reports
  // data_type='USER-DEFINED' with udt_name='vector' for a vector(N) column.
  const cols = await client.query(
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schemaName, tableName],
  );
  if (cols.rowCount === 0) {
    throw clientError(`Table ${schemaName}.${tableName} not found`, 404, 'TABLE_NOT_FOUND');
  }
  const pk = await client.query(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
        AND i.indisprimary`,
    [schemaName, tableName],
  );
  // Normalise the data type the adapter sees so /vector/i detection fires for pgvector.
  const displayType = (r) => (r.udt_name === 'vector' ? 'vector' : r.data_type);
  return {
    schemaName,
    tableName,
    columns: cols.rows.map((r) => ({ columnName: r.column_name, dataType: displayType(r), vector: r.udt_name === 'vector' })),
    columnNames: new Set(cols.rows.map((r) => r.column_name)),
    vectorColumns: cols.rows.filter((r) => r.udt_name === 'vector').map((r) => r.column_name),
    primaryKey: pk.rows.map((r) => r.column_name),
  };
}

// Resolve the declared dimension N of a vector(N) column from pgvector's type modifier
// (atttypmod). Used to validate an embedding-provider vector length before querying.
async function columnVectorDimension(client, schemaName, tableName, columnName) {
  const res = await client.query(
    `SELECT a.atttypmod AS typmod
       FROM pg_attribute a
      WHERE a.attrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
        AND a.attname = $3 AND NOT a.attisdropped`,
    [schemaName, tableName, columnName],
  );
  const typmod = res.rows[0]?.typmod;
  // pgvector stores the dimension directly in atttypmod (no -4 VARHDRSZ adjustment).
  return typmod && typmod > 0 ? Number(typmod) : undefined;
}

// Assemble the adapter request. Access metadata (grants/policies) is synthesised for
// the caller's role; the database itself remains the source of truth for grants and
// RLS — this layer's job is to drive the plan builder and stamp tenant scoping.
function buildRequest(params, table, ctx) {
  const role = ctx.roleName || DEFAULT_DATA_ROLE;
  const hasTenantColumn = table.columnNames.has(TENANT_COLUMN);

  // For writes, stamp tenant_id/workspace_id from the verified identity so an app
  // cannot insert/forge rows for another tenant.
  const stamp = (row) => {
    const out = { ...(row ?? {}) };
    if (hasTenantColumn) out[TENANT_COLUMN] = ctx.tenantId;
    if (table.columnNames.has(WORKSPACE_COLUMN)) out[WORKSPACE_COLUMN] = ctx.workspaceId;
    return out;
  };
  let values = params.values;
  let rows = params.rows;
  if (params.operation === 'insert') {
    values = stamp(params.values);
  } else if (params.operation === 'bulk_insert') {
    rows = (params.rows ?? []).map(stamp);
  }

  const tableSecurity = hasTenantColumn ? { rlsEnabled: true } : { rlsEnabled: false };
  const policies = hasTenantColumn
    ? [{
        policyName: `${table.tableName}_tenant_isolation`,
        appliesTo: { command: 'all', roles: ['public'] },
        runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: TENANT_COLUMN },
      }]
    : [];

  return {
    operation: params.operation ?? 'list',
    workspaceId: ctx.workspaceId,
    databaseName: ctx.databaseName,
    schemaName: table.schemaName,
    tableName: table.tableName,
    table: { schemaName: table.schemaName, tableName: table.tableName, columns: table.columns, primaryKey: table.primaryKey },
    select: params.select,
    filters: params.filters,
    filter: params.filter,
    order: params.order ?? [],
    page: params.page,
    primaryKey: params.primaryKey,
    values,
    rows,
    changes: params.changes,
    // KNN search fields (add-vector-search): queryVector is set by the executor either
    // directly or after resolving queryText through the embedding provider.
    queryVector: params.queryVector,
    queryText: params.queryText,
    vectorColumn: params.vectorColumn,
    metric: params.metric,
    topK: params.topK,
    responseOptions: { countMode: params.countMode ?? 'none' },
    actorRoleName: role,
    effectiveRoles: [role],
    actorId: ctx.actorId,
    tenantId: ctx.tenantId,
    sessionContext: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    tableSecurity,
    schemaGrants: [{ granteeRoleName: role, target: { schemaName: table.schemaName }, privileges: ['usage'] }],
    objectGrants: [{
      granteeRoleName: role,
      target: { schemaName: table.schemaName, objectName: table.tableName },
      privileges: ['select', 'insert', 'update', 'delete'],
    }],
    policies,
  };
}

async function runCount(client, countPlan) {
  if (!countPlan || !countPlan.sql?.text) return undefined;
  const res = await client.query(countPlan.sql.text, countPlan.sql.values ?? []);
  const raw = res.rows[0] ? Object.values(res.rows[0])[0] : undefined;
  return raw == null ? undefined : Number(raw);
}

// Execute a PostgreSQL data-API request end-to-end and return a shaped response.
// params: { operation, workspaceId, databaseName, schemaName, tableName,
//           identity:{tenantId, workspaceId, roleName, actorId},
//           select, filters, order, page, primaryKey, values, changes, countMode }
export async function executePostgresData(registry, params) {
  const identity = params.identity ?? {};
  const tenantId = identity.tenantId;
  const workspaceId = params.workspaceId ?? identity.workspaceId;
  if (!tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING');
  if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');

  const ctx = {
    tenantId,
    workspaceId,
    databaseName: params.databaseName,
    roleName: identity.roleName,
    actorId: identity.actorId,
  };

  // Build the plan first (introspection needs a connection, so do both inside the txn).
  // identity.dbRole (set by the API-key auth path: anon/service) is assumed via SET LOCAL
  // ROLE so RLS is enforced against it; the gateway-header path leaves the role unchanged.
  return registry.withWorkspaceClient(workspaceId, { tenantId, workspaceId, role: identity.dbRole }, async (client) => {
    const table = await introspectTable(client, params.schemaName, params.tableName);

    // KNN with queryText: resolve the in-platform embedding (workspace-scoped provider)
    // BEFORE building the plan; validate the returned dimension matches the column.
    const knnParams = { ...params };
    if (params.operation === 'knn_search' && !params.queryVector && params.queryText) {
      if (!params.embeddingExecutor) {
        throw clientError('In-platform embedding requires a configured provider', 422, 'EMBEDDING_PROVIDER_MISSING');
      }
      const vectorColumnName = params.vectorColumn ?? table.vectorColumns?.[0];
      const expectedDimension = vectorColumnName ? await columnVectorDimension(client, params.schemaName, params.tableName, vectorColumnName) : undefined;
      knnParams.queryVector = await params.embeddingExecutor.embedForWorkspace(workspaceId, params.queryText, { expectedDimension, tenantId });
    }

    let plan;
    try {
      plan = buildPostgresDataApiPlan(buildRequest(knnParams, table, ctx));
    } catch (error) {
      // Plan-time validation failure (bad filter, unknown column, access denied) → 4xx.
      const status = /No effective role/i.test(error.message) ? 403 : 400;
      throw clientError(error.message, status, 'PLAN_REJECTED');
    }

    // Apply the adapter's intended trace/session GUCs (app.current_* observability keys).
    for (const setting of plan.trace?.sessionSettings ?? []) {
      await client.query('SELECT set_config($1, $2, true)', [setting.key, String(setting.value)]);
    }

    let result;
    let count;
    try {
      result = await client.query(plan.sql.text, plan.sql.values);
      count = await runCount(client, plan.response?.count);
    } catch (error) {
      throw mapPgError(error);
    }

    if (plan.operation === 'knn_search') {
      // Rows are already RLS-scoped to the session tenant; each carries a `distance`.
      return { items: result.rows, returned: result.rowCount, knn: plan.knn, access: plan.access };
    }
    if (plan.operation === 'get') {
      return { found: result.rowCount > 0, item: result.rows[0] ?? null, access: plan.access };
    }
    if (['bulk_insert', 'bulk_update', 'bulk_delete'].includes(plan.operation)) {
      return { items: result.rows, affected: result.rowCount, access: plan.access };
    }
    if (['insert', 'update', 'delete'].includes(plan.operation)) {
      return { item: result.rows[0] ?? null, affected: result.rowCount, access: plan.access };
    }
    // Keyset pagination: when a full page came back, emit a next cursor built from the last
    // row's order-column values (the adapter's buildCursorClause decodes `order` to resume).
    const items = result.rows;
    const pageSize = plan.page?.size ?? items.length;
    let after;
    if (plan.order?.length && items.length > 0 && items.length >= pageSize) {
      const lastRow = items[items.length - 1];
      after = serializePostgresDataApiCursor({
        order: plan.order.map((entry) => ({ columnName: entry.columnName, direction: entry.direction, value: lastRow[entry.columnName] })),
      });
    }
    return {
      items,
      page: { size: pageSize, returned: result.rowCount, after },
      count,
      access: plan.access,
    };
  });
}
