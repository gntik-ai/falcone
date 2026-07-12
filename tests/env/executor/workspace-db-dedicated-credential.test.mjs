// Real-Postgres proof for add-rotatable-workspace-db-credential (GitHub issue #686, enhancement).
//
// Defect/gap: per-workspace DB credential rotation was an inert no-op — every workspace ran in
// `shared` mode (the single `falcone` login) because the provisioning role lacked CREATEROLE, so
// `POST .../database/credential-rotations` always returned 200 {rotated:false} and the old
// credential kept working. The fix enables the ALREADY-implemented dedicated path (the deploy
// bootstrap grants `falcone` CREATEROLE) and makes shared mode return an honest 409.
//
// This suite proves the dataplane functions against a REAL Postgres where the admin role CAN
// create roles (tests/env Postgres: the `falcone` superuser; CREATEROLE on the kind deploy is the
// equivalent enablement). It encodes the issue's Requirement + dedicated-rotation Scenario:
//   - provisionWorkspaceDatabase -> mode:'dedicated_role' with a dedicated username+password
//   - the dedicated credential can CONNECT to the new database (it owns it)
//   - rotateWorkspaceDatabaseCredential(... mode:'dedicated_role') -> rotated:true
//   - the OLD password is REJECTED by Postgres and the NEW password is ACCEPTED (REAL rotation)
//   - dropWorkspaceDatabase removes the database AND the dedicated role
//
// Run via tests/env/executor/run.sh (Postgres on localhost:55432, user/pass falcone/falcone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  provisionWorkspaceDatabase,
  rotateWorkspaceDatabaseCredential,
  dropWorkspaceDatabase,
} from '../../../apps/control-plane/dataplane.mjs';

const { Pool } = pg;

const PGHOST = process.env.PGHOST ?? 'localhost';
const PGPORT = process.env.PGPORT ?? '55432';
const PGUSER = process.env.PGUSER ?? 'falcone';
const PGPASSWORD = process.env.PGPASSWORD ?? 'falcone';
const PGDATABASE = process.env.PGDATABASE ?? 'falcone_test';

// dataplane.mjs interpolates PGHOST/PGPORT into the returned host/port/DSN; align them with the
// test-env Postgres so a fresh login pool below actually reaches the same server.
process.env.PGHOST = PGHOST;
process.env.PGPORT = PGPORT;

// Unique per-run prefix so parallel/repeat runs never collide on db/role names. dataplane.ident()
// lowercases + strips to [a-z0-9_], so keep the slugs lowercase-hex-ish.
const RUN = `686_${Date.now().toString(36)}`;
const TENANT_SLUG = `t${RUN}`;
const WS_SLUG = 'w';

let admin; // CREATEROLE-capable pool (the "control-plane" connection)
let provisioned; // the connection details returned by provisionWorkspaceDatabase

// Open a brand-new single connection AS the dedicated role with a given password, against the
// dedicated database, and return whether authentication succeeded. We must NOT reuse a pooled
// connection (password is checked at connect time).
async function canLogin({ username, password, database }) {
  const probe = new Pool({
    host: PGHOST, port: Number(PGPORT), user: username, password, database, max: 1,
    // Fail fast instead of retrying for the full default timeout on a rejected password.
    connectionTimeoutMillis: 4000,
  });
  try {
    const { rows } = await probe.query('SELECT current_user AS who');
    return { ok: true, who: rows[0].who };
  } catch (e) {
    return { ok: false, message: String(e.message ?? e) };
  } finally {
    await probe.end().catch(() => {});
  }
}

before(async () => {
  admin = new Pool({ host: PGHOST, port: Number(PGPORT), user: PGUSER, password: PGPASSWORD, database: PGDATABASE, max: 3 });
  // Sanity: this harness only proves the dedicated path, which requires a role-creating admin.
  const { rows } = await admin.query('SELECT (rolcreaterole OR rolsuper) AS can FROM pg_roles WHERE rolname=current_user');
  assert.equal(rows[0]?.can, true, 'test-env admin role must be able to create roles (CREATEROLE/superuser)');
});

after(async () => {
  // Best-effort teardown even if an assertion failed mid-test.
  if (admin) {
    if (provisioned?.database) { try { await dropWorkspaceDatabase(admin, provisioned.database); } catch { /* ignore */ } }
    await admin.end().catch(() => {});
  }
});

test('provisionWorkspaceDatabase mints a dedicated, connectable credential (Requirement: provisioning)', async () => {
  provisioned = await provisionWorkspaceDatabase(admin, { tenantSlug: TENANT_SLUG, wsSlug: WS_SLUG });

  assert.equal(provisioned.mode, 'dedicated_role', 'dedicated path must engage when the admin can create roles');
  assert.equal(provisioned.engine, 'postgresql');
  assert.ok(provisioned.database?.startsWith('wsdb_'), 'workspace db name is wsdb_*');
  assert.ok(provisioned.username && provisioned.username !== PGUSER, 'a dedicated login role distinct from the platform user');
  assert.ok(typeof provisioned.password === 'string' && provisioned.password.length >= 32, 'a one-time dedicated password is surfaced');

  // The dedicated credential is the database OWNER and was granted CONNECT -> it can authenticate.
  const login = await canLogin({ username: provisioned.username, password: provisioned.password, database: provisioned.database });
  assert.ok(login.ok, `dedicated credential should connect to its own database; got: ${login.message ?? ''}`);
  assert.equal(login.who, provisioned.username);
});

test('rotateWorkspaceDatabaseCredential performs a REAL rotation: old rejected, new accepted (Scenario: dedicated)', async () => {
  assert.ok(provisioned, 'provisioning test must run first');
  const oldPassword = provisioned.password;

  const rotated = await rotateWorkspaceDatabaseCredential(admin, {
    database: provisioned.database, mode: provisioned.mode, username: provisioned.username,
  });

  // The response confirms the rotation and carries the NEW credential.
  assert.equal(rotated.rotated, true, 'dedicated-mode rotation must report rotated:true');
  assert.equal(rotated.username, provisioned.username, 'same role, new password');
  assert.ok(rotated.password && rotated.password !== oldPassword, 'a fresh password is issued');
  assert.ok(rotated.dsn?.includes(rotated.password), 'the returned DSN embeds the new password');

  // REAL rotation: Postgres must REJECT the old password and ACCEPT the new one.
  const oldLogin = await canLogin({ username: provisioned.username, password: oldPassword, database: provisioned.database });
  assert.equal(oldLogin.ok, false, 'OLD password must be rejected by Postgres after rotation');

  const newLogin = await canLogin({ username: rotated.username, password: rotated.password, database: provisioned.database });
  assert.ok(newLogin.ok, `NEW password must be accepted by Postgres after rotation; got: ${newLogin.message ?? ''}`);
  assert.equal(newLogin.who, provisioned.username);

  // Keep the surfaced credential current for teardown bookkeeping.
  provisioned = { ...provisioned, password: rotated.password };
});

test('dropWorkspaceDatabase removes both the dedicated database and its role', async () => {
  assert.ok(provisioned, 'provisioning test must run first');
  await dropWorkspaceDatabase(admin, provisioned.database);

  const { rows: dbRows } = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [provisioned.database]);
  assert.equal(dbRows.length, 0, 'workspace database is dropped');
  const { rows: roleRows } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [provisioned.username]);
  assert.equal(roleRows.length, 0, 'dedicated role is dropped');

  provisioned = null; // already cleaned up; skip the after() drop
});

test('rotateWorkspaceDatabaseCredential is a discriminated no-op in shared mode (pure function)', async () => {
  // No Postgres call needed: shared mode short-circuits to {rotated:false, reason}. The HANDLER
  // maps this to a 409 (covered by the handler-level black-box test); here we pin the pure
  // function's discriminated return so the contract the handler relies on cannot drift.
  const res = await rotateWorkspaceDatabaseCredential(admin, { database: 'wsdb_shared_probe', mode: 'shared', username: PGUSER });
  assert.equal(res.rotated, false, 'shared mode rotates nothing');
  assert.ok(typeof res.reason === 'string' && res.reason.length > 0, 'a human-readable reason is returned');
});
