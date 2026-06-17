// Real-Postgres proof for fix-workspace-db-provisioning-saga (#502): the data-plane connection
// registry, driven by the per-workspace DSN resolver, actually connects to the workspace's OWN
// provisioned database (wsdb_*) — not the shared control-plane DB — and falls back to the shared
// DB for a workspace with no provisioned database. Run via tests/env/executor/run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { createWorkspaceDsnResolver } from '../../../apps/control-plane/src/runtime/workspace-dsn-resolver.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const CONTROL_DB = 'cp_routing_control';   // stands in for in_falcone (holds workspace_databases)
const WS_DB = 'wsdb_route_probe';          // the workspace's own provisioned database
const WS_ID = 'ws_routed';

let bootstrap; let control; let registry;
const urlFor = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  for (const db of [CONTROL_DB, WS_DB]) await bootstrap.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${CONTROL_DB}`);
  await bootstrap.query(`CREATE DATABASE ${WS_DB}`); // the "provisioned" workspace database

  control = new Pool({ connectionString: urlFor(CONTROL_DB), max: 2 });
  await control.query(`CREATE TABLE workspace_databases (
      workspace_id text PRIMARY KEY, tenant_id text, engine text, database_name text NOT NULL,
      mode text, username text, host text, port int)`);
  await control.query(
    `INSERT INTO workspace_databases (workspace_id, tenant_id, engine, database_name, mode)
     VALUES ($1, 't', 'postgresql', $2, 'shared')`, [WS_ID, WS_DB]);

  const resolve = createWorkspaceDsnResolver({ pool: control, baseDsn: urlFor(CONTROL_DB) });
  registry = createConnectionRegistry({ resolveConnection: resolve });
});

after(async () => {
  await registry?.end().catch(() => {});
  await control?.end().catch(() => {});
  if (bootstrap) {
    for (const db of [CONTROL_DB, WS_DB]) await bootstrap.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('a provisioned workspace routes the data connection to its OWN database', async () => {
  const db = await registry.withWorkspaceClient(WS_ID, { tenantId: 't', workspaceId: WS_ID }, async (client) =>
    (await client.query('SELECT current_database() AS db')).rows[0].db);
  assert.equal(db, WS_DB, 'data connection lands in the workspace database, not the control DB');
});

test('an unprovisioned workspace falls back to the shared control-plane database', async () => {
  const db = await registry.withWorkspaceClient('ws_unprovisioned', { tenantId: 't', workspaceId: 'ws_unprovisioned' }, async (client) =>
    (await client.query('SELECT current_database() AS db')).rows[0].db);
  assert.equal(db, CONTROL_DB, 'workspace with no provisioned DB uses the shared DSN (backward compatible)');
});
