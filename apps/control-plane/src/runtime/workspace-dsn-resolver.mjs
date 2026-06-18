// Per-workspace DSN routing (fix-workspace-db-provisioning-saga, #502).
//
// The data API must run against the workspace's OWN provisioned database (wsdb_*), not the
// shared control-plane metadata database — otherwise the per-workspace databases the
// provisioning saga creates are dead weight and every workspace co-mingles in one catalog.
// This resolver looks the workspace's database up in the `workspace_databases` registry and
// returns a DSN routed to it, derived from the base (control-plane) DSN with only the database
// name swapped — so the executor keeps using the control-plane data credential, which OWNS the
// wsdb_* databases and is a member of the falcone_service/falcone_anon roles (so SET LOCAL ROLE
// for RLS still applies inside the workspace database). Workspaces without a provisioned database
// fall back to the base DSN (backward compatible). Positive lookups are cached — a workspace's
// database name never changes once provisioned.

// Swap ONLY the database path segment of a libpq URL, preserving user/password/host/port and any
// query string (e.g. ?sslmode=disable). Credentials are never parsed, so a password with special
// characters is carried through verbatim.
export function dsnWithDatabase(baseDsn, databaseName) {
  return baseDsn.replace(/\/[^/?]+(\?.*)?$/, `/${databaseName}$1`);
}

// pool: a control-plane metadata pool (where workspace_databases lives).
// baseDsn: the shared control-plane data DSN (the fallback + the credential/host source).
export function createWorkspaceDsnResolver({ pool, baseDsn }) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('createWorkspaceDsnResolver requires a pg pool');
  if (typeof baseDsn !== 'string' || !baseDsn) throw new TypeError('createWorkspaceDsnResolver requires a baseDsn');
  const cache = new Map(); // workspaceId -> routed dsn

  async function resolveConnection(workspaceId) {
    const wsId = workspaceId ? String(workspaceId) : '';
    // `routed` distinguishes a per-workspace database (a dedicated wsdb_*) from the
    // shared/platform fallback. Consumers that must NOT operate on the platform
    // database (DDL — see connection-registry withAdminClient requireDedicatedDatabase)
    // fail closed when routed === false (fix-executor-ddl-db-ownership-guard).
    if (wsId) {
      const cached = cache.get(wsId);
      if (cached) return { dsn: cached, routed: true };
      try {
        const { rows } = await pool.query(
          'SELECT database_name FROM workspace_databases WHERE workspace_id = $1 LIMIT 1',
          [wsId],
        );
        if (rows[0]?.database_name) {
          const routed = dsnWithDatabase(baseDsn, rows[0].database_name);
          cache.set(wsId, routed);
          return { dsn: routed, routed: true };
        }
      } catch {
        // Registry unreachable or table absent → fall back to the shared DSN (fail-open to the
        // pre-routing behaviour rather than taking the whole data plane down).
      }
    }
    return { dsn: baseDsn, routed: false };
  }

  // Drop a cached mapping (e.g. after a workspace's database is deprovisioned).
  resolveConnection.invalidate = (workspaceId) => cache.delete(String(workspaceId));
  return resolveConnection;
}

// Resolve a workspace to its OWNING tenant from the same `workspace_databases` registry
// (fix-executor-apikey-cross-tenant-idor, #517). Used by the executor's request dispatch to
// reject cross-tenant access: a caller may only operate on a workspace its own tenant owns.
//
// Returns the owning tenant_id (string), or undefined when the workspace has no provisioned
// database / no ownership record yet — callers treat "unknown owner" as "not a known foreign
// tenant" (the api-key path then binds the key to the caller's own tenant and RLS scopes it).
// A registry-lookup failure also resolves to undefined: the metadata pool that backs this lookup
// also backs api-key issuance itself, so a real outage fails the write rather than the check.
// pool: a control-plane metadata pool (where workspace_databases lives).
export function createWorkspaceTenantResolver({ pool }) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('createWorkspaceTenantResolver requires a pg pool');
  const cache = new Map(); // workspaceId -> owning tenant_id (only positive results cached)

  async function resolveWorkspaceTenant(workspaceId) {
    const wsId = workspaceId ? String(workspaceId) : '';
    if (!wsId) return undefined;
    const cached = cache.get(wsId);
    if (cached) return cached;
    try {
      const { rows } = await pool.query(
        'SELECT tenant_id FROM workspace_databases WHERE workspace_id = $1 LIMIT 1',
        [wsId],
      );
      const owner = rows[0]?.tenant_id;
      if (owner) cache.set(wsId, owner); // a workspace's owning tenant never changes once set
      return owner ?? undefined;
    } catch {
      return undefined; // registry unreachable → unknown owner (issuance write fails closed elsewhere)
    }
  }

  resolveWorkspaceTenant.invalidate = (workspaceId) => cache.delete(String(workspaceId));
  return resolveWorkspaceTenant;
}
