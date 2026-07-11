// Durable state store for the MCP management engine.
//
// The MCP engine keeps the reviewed curation/registry/quota logic in-process, but the core
// platform now runs that engine by default. Persisting the engine snapshot in the control-plane
// metadata database makes MCP servers, published versions, audit records, and rate windows survive
// executor restarts without adding a second service-specific database contract.

export function createMcpPostgresStore({ pool, tableName = 'falcone_mcp_state' } = {}) {
  if (!pool) throw new Error('createMcpPostgresStore requires a pg pool');
  const ident = tableName.split('.').map((part) => `"${String(part).replace(/"/g, '""')}"`).join('.');
  let schemaReady;

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS ${ident} (
          id text PRIMARY KEY,
          state jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    }
    await schemaReady;
  }

  async function loadState() {
    await ensureSchema();
    const { rows } = await pool.query(`SELECT state FROM ${ident} WHERE id = $1`, ['default']);
    return rows[0]?.state ?? null;
  }

  async function saveState(state) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO ${ident} (id, state, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE
         SET state = EXCLUDED.state,
             updated_at = EXCLUDED.updated_at`,
      ['default', JSON.stringify(state ?? {})],
    );
  }

  return { ensureSchema, loadState, saveState };
}
