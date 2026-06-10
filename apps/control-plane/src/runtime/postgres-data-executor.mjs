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
import { buildPostgresDataApiPlan } from '../../../../services/adapters/src/postgresql-data-api.mjs';

const DEFAULT_DATA_ROLE = 'falcone_app';
const TENANT_COLUMN = 'tenant_id';
const WORKSPACE_COLUMN = 'workspace_id';

function clientError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// Introspect a table into the shape buildPostgresDataApiPlan expects:
// { schemaName, tableName, columns:[{columnName,dataType}], primaryKey:[...] }.
export async function introspectTable(client, schemaName, tableName) {
  const cols = await client.query(
    `SELECT column_name, data_type
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
  return {
    schemaName,
    tableName,
    columns: cols.rows.map((r) => ({ columnName: r.column_name, dataType: r.data_type })),
    columnNames: new Set(cols.rows.map((r) => r.column_name)),
    primaryKey: pk.rows.map((r) => r.column_name),
  };
}

// Assemble the adapter request. Access metadata (grants/policies) is synthesised for
// the caller's role; the database itself remains the source of truth for grants and
// RLS — this layer's job is to drive the plan builder and stamp tenant scoping.
function buildRequest(params, table, ctx) {
  const role = ctx.roleName || DEFAULT_DATA_ROLE;
  const hasTenantColumn = table.columnNames.has(TENANT_COLUMN);

  // For writes, stamp tenant_id/workspace_id from the verified identity so an app
  // cannot insert/forge rows for another tenant.
  let values = params.values;
  if (params.operation === 'insert') {
    values = { ...(params.values ?? {}) };
    if (hasTenantColumn) values[TENANT_COLUMN] = ctx.tenantId;
    if (table.columnNames.has(WORKSPACE_COLUMN)) values[WORKSPACE_COLUMN] = ctx.workspaceId;
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
    order: params.order ?? [],
    page: params.page,
    primaryKey: params.primaryKey,
    values,
    changes: params.changes,
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
  return registry.withWorkspaceClient(workspaceId, { tenantId, workspaceId }, async (client) => {
    const table = await introspectTable(client, params.schemaName, params.tableName);

    let plan;
    try {
      plan = buildPostgresDataApiPlan(buildRequest(params, table, ctx));
    } catch (error) {
      // Plan-time validation failure (bad filter, unknown column, access denied) → 4xx.
      const status = /No effective role/i.test(error.message) ? 403 : 400;
      throw clientError(error.message, status, 'PLAN_REJECTED');
    }

    // Apply the adapter's intended trace/session GUCs (app.current_* observability keys).
    for (const setting of plan.trace?.sessionSettings ?? []) {
      await client.query('SELECT set_config($1, $2, true)', [setting.key, String(setting.value)]);
    }

    const result = await client.query(plan.sql.text, plan.sql.values);

    if (plan.operation === 'get') {
      return { found: result.rowCount > 0, item: result.rows[0] ?? null, access: plan.access };
    }
    if (['insert', 'update', 'delete'].includes(plan.operation)) {
      return { item: result.rows[0] ?? null, affected: result.rowCount, access: plan.access };
    }
    const count = await runCount(client, plan.response?.count);
    return {
      items: result.rows,
      page: { size: plan.page?.size ?? result.rowCount, returned: result.rowCount },
      count,
      access: plan.access,
    };
  });
}
