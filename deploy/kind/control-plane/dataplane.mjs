// Workspace data-plane provisioning (domain B, kind deploy).
//
// The repo stubs workspace database/function provisioning (the data-plane sagas
// only snapshot()). Postgres IS running in this deploy, so we provision a REAL
// database per workspace on it — genuine catalog-level isolation, the canonical
// BaaS "database-per-workspace" primitive. When the control-plane DB role has
// CREATEROLE we also mint a dedicated, scoped login role + password (true tenant
// credential isolation); when it does not (this deploy's `falcone` role lacks it
// and no superuser is exposed) we degrade gracefully to the shared connection and
// report `mode: 'shared'` so the caller/UI knows the isolation level it got.
//
// Functions need the OpenWhisk data plane, which is a stub in this deploy, so the
// function "provisioning" is an honest metadata REGISTRY: it records the function
// and reports runtimeStatus 'pending_data_plane' (no fake "deployed" claim).
import { randomBytes } from 'node:crypto';

const PGHOST = process.env.PGHOST || 'falcone-postgresql';
const PGPORT = process.env.PGPORT || '5432';
const PGUSER = process.env.PGUSER || 'falcone';
const PGPASSWORD = process.env.PGPASSWORD || '';

// Postgres identifiers: lowercase, [a-z0-9_], must start with a letter, <=63 bytes.
// We sanitize+validate then interpolate (DDL cannot bind identifiers as params).
function ident(s, prefix = 'x') {
  let v = String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(v)) v = prefix + '_' + v;
  v = v.slice(0, 60);
  if (!/^[a-z][a-z0-9_]*$/.test(v)) throw new Error(`could not derive a safe identifier from "${s}"`);
  return v;
}
// 48 hex chars — only [0-9a-f], so it is safe to inline in a SQL string literal
// (no quote/escape hazard) while staying high-entropy.
function genPassword() { return randomBytes(24).toString('hex'); }

async function databaseExists(pool, db) {
  const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [db]);
  return rows.length > 0;
}
async function roleExists(pool, role) {
  const { rows } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
  return rows.length > 0;
}
async function canCreateRole(pool) {
  const { rows } = await pool.query(`SELECT rolcreaterole OR rolsuper AS can FROM pg_roles WHERE rolname=current_user`);
  return rows[0]?.can === true;
}

// Provision a real database for the workspace. Returns the connection details
// (and the role password ONCE, at creation — it is not persisted, mirroring how
// service-account secrets are surfaced once). Throws { code } the caller maps.
export async function provisionWorkspaceDatabase(pool, { tenantSlug, wsSlug }) {
  const db = ident(`wsdb_${tenantSlug || 't'}_${wsSlug || 'w'}`, 'wsdb');
  if (await databaseExists(pool, db)) {
    throw Object.assign(new Error(`database ${db} already exists`), { statusCode: 409, code: 'DB_EXISTS' });
  }
  const withRole = await canCreateRole(pool);
  const role = withRole ? ident(`${db}_app`, 'app') : null;
  const password = withRole ? genPassword() : null;
  const created = { role: false, database: false };
  try {
    if (withRole && !(await roleExists(pool, role))) {
      // password is pure hex -> safe to inline; identifiers are validated above.
      await pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
      created.role = true;
    }
    // CREATE DATABASE cannot run inside a transaction; pool.query is autocommit.
    await pool.query(`CREATE DATABASE "${db}"${withRole ? ` OWNER "${role}"` : ''}`);
    created.database = true;
    // Lock the database down: no implicit PUBLIC connect; grant only the owner/role.
    await pool.query(`REVOKE CONNECT ON DATABASE "${db}" FROM PUBLIC`);
    if (withRole) await pool.query(`GRANT CONNECT ON DATABASE "${db}" TO "${role}"`);
  } catch (e) {
    // best-effort cleanup of whatever we managed to create before the failure
    if (created.database) { try { await pool.query(`DROP DATABASE IF EXISTS "${db}"`); } catch {} }
    if (created.role)     { try { await pool.query(`DROP ROLE IF EXISTS "${role}"`); } catch {} }
    throw e;
  }
  const username = withRole ? role : PGUSER;
  return {
    mode: withRole ? 'dedicated_role' : 'shared',
    engine: 'postgresql',
    database: db,
    host: PGHOST,
    port: Number(PGPORT),
    username,
    password: withRole ? password : null,
    // shared mode reuses the control-plane DB credential — surfaced so the caller
    // can decide; dedicated mode hands back a freshly minted, db-scoped login.
    passwordHint: withRole ? null : 'uses the platform DB credential (no CREATEROLE on this deploy)',
    dsn: withRole
      ? `postgresql://${username}:${password}@${PGHOST}:${PGPORT}/${db}`
      : `postgresql://${username}@${PGHOST}:${PGPORT}/${db}`,
    sslmode: 'disable'
  };
}

// Rotate the dedicated role's password (no-op-with-note in shared mode).
export async function rotateWorkspaceDatabaseCredential(pool, { database, mode, username }) {
  if (mode !== 'dedicated_role' || !username) {
    return { rotated: false, reason: 'shared-mode database has no dedicated credential to rotate' };
  }
  const role = ident(username, 'app');
  const password = genPassword();
  await pool.query(`ALTER ROLE "${role}" PASSWORD '${password}'`);
  return {
    rotated: true, mode, database, host: PGHOST, port: Number(PGPORT), username: role, password,
    dsn: `postgresql://${role}:${password}@${PGHOST}:${PGPORT}/${database}`
  };
}

// Drop a provisioned database (used by the saga compensator and explicit delete):
// terminate stragglers, drop the db, then drop the dedicated role if present.
export async function dropWorkspaceDatabase(pool, database) {
  const db = ident(database, 'wsdb');
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [db]);
  } catch {}
  await pool.query(`DROP DATABASE IF EXISTS "${db}"`);
  const role = `${db}_app`.slice(0, 60);
  if (await roleExists(pool, role)) { try { await pool.query(`DROP ROLE IF EXISTS "${role}"`); } catch {} }
}

export { ident as _ident };
