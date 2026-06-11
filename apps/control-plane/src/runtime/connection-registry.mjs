// Workspace → database connection registry (change: add-workspace-db-connection-registry).
//
// The control-plane executor runs adapter-built SQL/command plans against the
// CORRECT per-workspace database, as a NON-superuser application role, with the
// tenant RLS context (app.tenant_id / app.workspace_id) set per transaction via
// SET LOCAL semantics (set_config(..., is_local=true)). SET LOCAL is scoped to the
// transaction, so a pooled connection can never leak one request's tenant context
// to the next borrower. A separate admin/superuser path is provided for catalog
// introspection, DDL and legitimate cross-tenant/migration work (it bypasses RLS).
//
// `resolveConnection(workspaceId)` is injected (the DSN source is the data-plane
// provisioner); it returns { dsn, adminDsn? }. Pools are keyed by DSN and reused.
import pg from 'pg';

const { Pool } = pg;

function failClosed(message, code) {
  return Object.assign(new Error(message), { code, statusCode: 503 });
}

export function createConnectionRegistry(options = {}) {
  if (typeof options.resolveConnection !== 'function') {
    throw new TypeError('createConnectionRegistry requires a resolveConnection(workspaceId) function');
  }
  const max = options.max ?? 8;
  const pools = new Map(); // dsn -> Pool

  function poolFor(dsn) {
    let pool = pools.get(dsn);
    if (!pool) {
      pool = new Pool({ connectionString: dsn, max });
      pools.set(dsn, pool);
    }
    return pool;
  }

  async function resolve(workspaceId) {
    const wsId = String(workspaceId ?? '').trim();
    if (!wsId) throw failClosed('workspaceId is required to resolve a database connection', 'WORKSPACE_ID_MISSING');
    let conn;
    try {
      conn = await options.resolveConnection(wsId);
    } catch (error) {
      throw failClosed(`Failed to resolve database for workspace ${wsId}: ${error.message}`, 'WORKSPACE_DB_RESOLVE_FAILED');
    }
    if (!conn || !conn.dsn) {
      throw failClosed(`No database is provisioned for workspace ${wsId}`, 'WORKSPACE_DB_UNRESOLVED');
    }
    return conn;
  }

  const ROLE_IDENT = /^[a-z_][a-z0-9_]*$/;

  async function applyRlsContext(client, context = {}) {
    // Assume the credential's DB role for this transaction so RLS is evaluated
    // against it (e.g. an anon key drops to a non-BYPASSRLS role). SET LOCAL ROLE is
    // transaction-scoped, so it never leaks to the next pooled borrower.
    if (context.role) {
      if (!ROLE_IDENT.test(context.role)) {
        throw failClosed(`Invalid database role ${context.role}`, 'INVALID_DB_ROLE');
      }
      await client.query(`SET LOCAL ROLE "${context.role}"`);
    }
    if (context.tenantId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(context.tenantId)]);
    }
    if (context.workspaceId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.workspace_id', String(context.workspaceId)]);
    }
    for (const setting of context.sessionSettings ?? []) {
      if (setting && setting.key && setting.value != null) {
        await client.query('SELECT set_config($1, $2, true)', [setting.key, String(setting.value)]);
      }
    }
  }

  // Run fn(client) inside a transaction on the workspace's database, with the
  // tenant RLS context established. Commits on success, rolls back on error,
  // always releases the connection.
  async function withWorkspaceClient(workspaceId, context, fn) {
    if (typeof fn !== 'function') throw new TypeError('withWorkspaceClient requires a callback');
    const { dsn } = await resolve(workspaceId);
    const client = await poolFor(dsn).connect();
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, context);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* surface original error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  // Admin/superuser path: catalog introspection, DDL, migration/sweep work.
  // Bypasses RLS; no implicit transaction (caller manages it if needed).
  async function withAdminClient(workspaceId, fn) {
    if (typeof fn !== 'function') throw new TypeError('withAdminClient requires a callback');
    const { dsn, adminDsn } = await resolve(workspaceId);
    const client = await poolFor(adminDsn ?? dsn).connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async function end() {
    await Promise.all([...pools.values()].map((pool) => pool.end().catch(() => {})));
    pools.clear();
  }

  return { withWorkspaceClient, withAdminClient, end };
}
