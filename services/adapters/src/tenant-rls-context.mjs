// Tenant RLS context helper.
//
// The RLS policies added in the service migrations (e.g.
// services/scheduling-engine/migrations/002-rls-scheduling-tables.sql) evaluate
// `current_setting('app.tenant_id'|'app.workspace_id', true)`. For a non-superuser
// application role those settings MUST be established on the connection before any
// tenant-scoped query runs, otherwise the policy is fail-closed (zero rows).
//
// `SET LOCAL` only persists for the duration of a transaction, which is exactly
// what we want with a connection pool: the setting is scoped to one checked-out
// connection for one unit of work and cannot leak to the next pooled borrower.
//
// Usage:
//   await withTenantRlsContext(pool, { tenantId, workspaceId }, async (client) => {
//     return client.query('SELECT * FROM scheduled_jobs'); // RLS-scoped, no WHERE needed
//   });

function assertContext({ tenantId, workspaceId } = {}) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw Object.assign(new Error('withTenantRlsContext requires a non-empty tenantId'), {
      code: 'RLS_CONTEXT_MISSING_TENANT',
    });
  }
  if (workspaceId != null && typeof workspaceId !== 'string') {
    throw Object.assign(new Error('withTenantRlsContext workspaceId must be a string when provided'), {
      code: 'RLS_CONTEXT_INVALID_WORKSPACE',
    });
  }
}

/**
 * Set the RLS GUCs on an already-open transaction. Use this when the caller owns
 * the BEGIN/COMMIT (e.g. an existing transactional repository). Parameterized via
 * set_config(..., true) so the values are bound, never string-concatenated.
 */
export async function setTenantRlsContext(client, { tenantId, workspaceId } = {}) {
  assertContext({ tenantId, workspaceId });
  // set_config(setting, value, is_local=true) == SET LOCAL, but accepts bind params.
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
  if (workspaceId != null) {
    await client.query('SELECT set_config($1, $2, true)', ['app.workspace_id', workspaceId]);
  }
}

/**
 * Run `fn(client)` inside a transaction that has the tenant RLS context set, on a
 * dedicated connection checked out from the pool. Commits on success, rolls back on
 * error, and always releases the connection back to the pool.
 *
 * @param {{connect: Function}} pool - a pg Pool
 * @param {{tenantId: string, workspaceId?: string}} context
 * @param {(client: any) => Promise<any>} fn
 */
export async function withTenantRlsContext(pool, context, fn) {
  assertContext(context);
  if (typeof fn !== 'function') {
    throw new TypeError('withTenantRlsContext requires a callback function');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantRlsContext(client, context);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failures; surface the original error
    }
    throw error;
  } finally {
    client.release();
  }
}
