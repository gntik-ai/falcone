// Shared logical-replication provisioning helpers — change add-ferretdb-realtime-cdc-remediation
// (#460). Used by the CDC bridge (ChangeStreamManager) and the realtime executor against the
// DocumentDB engine. The publication is schema-scoped to `documentdb_data`; REPLICA IDENTITY FULL is
// sweep-applied to existing `documents_*` tables so DELETE WAL records carry the pre-image (required
// to tenant-scope deletes). Tables created later need the same treatment from the engine's own
// provisioning (event trigger / periodic job) — see the chart provisioning step (#460 task 2).
//
// These run idempotently; they require an engine role with privilege to CREATE PUBLICATION, ALTER
// the documentdb_data tables, and create/drop replication slots (operator-provisioned, distinct from
// the non-BYPASSRLS falcone_app application role).
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function assertIdent(name, kind) {
  if (typeof name !== 'string' || !SAFE_IDENT.test(name)) throw new Error(`Unsafe ${kind} name: ${name}`);
}

export async function ensurePublicationAndReplicaIdentity(pool, publicationName) {
  assertIdent(publicationName, 'publication');
  const { rows } = await pool.query('SELECT 1 FROM pg_publication WHERE pubname = $1', [publicationName]);
  if (!rows.length) await pool.query(`CREATE PUBLICATION ${publicationName} FOR TABLES IN SCHEMA documentdb_data`);
  const { rows: tables } = await pool.query(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'documentdb_data' AND relname LIKE 'documents_%' AND relkind = 'r'"
  );
  for (const t of tables) await pool.query(`ALTER TABLE documentdb_data.${t.relname} REPLICA IDENTITY FULL`);
}

export async function slotExists(pool, slotName) {
  const { rows } = await pool.query('SELECT 1 FROM pg_replication_slots WHERE slot_name = $1', [slotName]);
  return rows.length > 0;
}

// Durable slot (CDC bridge): create only if missing, so the confirmed LSN resume cursor survives.
export async function ensureSlot(pool, slotName) {
  assertIdent(slotName, 'slot');
  if (!(await slotExists(pool, slotName))) {
    await pool.query("SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slotName]);
  }
}

export async function dropSlot(pool, slotName) {
  await pool.query('SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1', [slotName]);
}

// Fresh slot (realtime): drop + recreate so it starts at the CURRENT WAL position. Realtime SSE is
// live-only and best-effort — it must not replay history or pin WAL across process restarts.
export async function createFreshSlot(pool, slotName) {
  assertIdent(slotName, 'slot');
  await dropSlot(pool, slotName);
  await pool.query("SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slotName]);
}
