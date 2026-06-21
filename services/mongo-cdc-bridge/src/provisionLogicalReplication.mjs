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
  // Also read relreplident: 'f' means REPLICA IDENTITY FULL is already set.
  const { rows: tables } = await pool.query(
    "SELECT relname, relreplident FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'documentdb_data' AND relname LIKE 'documents_%' AND relkind = 'r'"
  );
  for (const t of tables) {
    assertIdent(t.relname, 'table'); // defence-in-depth: relname is interpolated below
    // #688: the live realtime replication role (falcone_cdc_repl) does NOT own the engine's
    // `documents_*` tables (owner = documentdb_admin_role) and has no membership in the owner
    // role. Postgres checks table ownership BEFORE no-op detection, so re-issuing
    // `ALTER TABLE … REPLICA IDENTITY FULL` as a non-owner throws `42501 must be owner of table`
    // even when the table is already FULL — aborting the WAL consumer for ALL tenants over a
    // redundant no-op. So:
    //   - Skip the ALTER when the table is already FULL ('f') — nothing to do, and re-issuing it
    //     as a non-owner would only raise 42501.
    //   - For tables not yet FULL, attempt the ALTER but TOLERATE `42501` (insufficient_privilege)
    //     without throwing: the owner-privileged engine-init / migration job (chart provisioning,
    //     #460 task 2) is responsible for setting REPLICA IDENTITY FULL; a non-owner live
    //     replication role must not abort the consumer over a table it cannot (and may not need to)
    //     alter. Any OTHER error is re-thrown.
    // This function is shared with the CDC bridge: an owner-privileged role still applies the ALTER
    // to not-yet-FULL tables, and already-FULL tables are skipped either way — so the change is safe
    // for both consumers.
    if (t.relreplident === 'f') continue;
    try {
      await pool.query(`ALTER TABLE documentdb_data.${t.relname} REPLICA IDENTITY FULL`);
    } catch (err) {
      if (err?.code !== '42501') throw err;
    }
  }
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
