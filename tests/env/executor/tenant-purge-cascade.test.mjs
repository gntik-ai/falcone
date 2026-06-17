// Real-Postgres proof for add-tenant-delete-purge-cascade (#501): store.purgeTenant removes
// EVERY row a tenant owns across all registry tables (workspaces, databases, buckets, topics,
// service accounts, api keys, functions, async-ops) and returns the physical resources to tear
// down — without touching another tenant's rows. Run via tests/env/executor/run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as store from '../../../deploy/kind/control-plane/tenant-store.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const PROBE_DB = 'cp_purge_probe';
const TEN = 'ten_purge'; const OTHER = 'ten_keep'; // OTHER must survive (cross-tenant safety)
const WS = 'ws_purge'; const OWS = 'ws_keep';

let bootstrap; let pool;
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

// The owned-resource tables a tenant touches (subset sufficient to prove the cascade).
const SCHEMA = `
  CREATE TABLE tenants (id text PRIMARY KEY, slug text, display_name text, status text DEFAULT 'active', iam_realm text);
  CREATE TABLE workspaces (id text PRIMARY KEY, tenant_id text, slug text, display_name text);
  CREATE TABLE workspace_databases (id text PRIMARY KEY, workspace_id text, tenant_id text, engine text, database_name text, mode text, username text, host text, port int);
  CREATE TABLE workspace_buckets (id text PRIMARY KEY, workspace_id text, tenant_id text, bucket_name text);
  CREATE TABLE workspace_topics (id text PRIMARY KEY, workspace_id text, tenant_id text, topic_name text, physical_topic_name text);
  CREATE TABLE workspace_functions (id text PRIMARY KEY, workspace_id text, tenant_id text, name text);
  CREATE TABLE fn_actions (resource_id text PRIMARY KEY, workspace_id text, tenant_id text, action_name text, ksvc_name text);
  CREATE TABLE fn_activations (activation_id text PRIMARY KEY, resource_id text, workspace_id text, status text);
  CREATE TABLE service_accounts (id text PRIMARY KEY, workspace_id text, tenant_id text, iam_realm text, kc_client_id text, kc_client_uuid text, display_name text);
  CREATE TABLE workspace_api_keys (id serial PRIMARY KEY, tenant_id text, workspace_id text, key_type text, key_prefix text, key_hash text, scopes jsonb);
  CREATE TABLE async_operations (operation_id text PRIMARY KEY, tenant_id text, status text);
  CREATE TABLE async_operation_transitions (id serial PRIMARY KEY, operation_id text, tenant_id text);
`;

async function seed(ten, ws, dbname) {
  await pool.query("INSERT INTO tenants (id,slug,display_name,iam_realm) VALUES ($1,$1,$1,$1)", [ten]);
  await pool.query('INSERT INTO workspaces (id,tenant_id,slug,display_name) VALUES ($1,$2,$1,$1)', [ws, ten]);
  await pool.query('INSERT INTO workspace_databases (id,workspace_id,tenant_id,engine,database_name,mode,username,host,port) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [`db_${ws}`, ws, ten, 'postgresql', dbname, 'shared', 'falcone', 'h', 5432]);
  await pool.query('INSERT INTO workspace_buckets (id,workspace_id,tenant_id,bucket_name) VALUES ($1,$2,$3,$4)', [`b_${ws}`, ws, ten, `bucket-${ws}`]);
  await pool.query('INSERT INTO workspace_topics (id,workspace_id,tenant_id,topic_name,physical_topic_name) VALUES ($1,$2,$3,$4,$5)', [`t_${ws}`, ws, ten, 'orders', `phys-${ws}`]);
  await pool.query('INSERT INTO workspace_functions (id,workspace_id,tenant_id,name) VALUES ($1,$2,$3,$4)', [`f_${ws}`, ws, ten, 'fn']);
  await pool.query('INSERT INTO fn_actions (resource_id,workspace_id,tenant_id,action_name,ksvc_name) VALUES ($1,$2,$3,$4,$5)', [`a_${ws}`, ws, ten, 'act', `ksvc-${ws}`]);
  await pool.query('INSERT INTO fn_activations (activation_id,resource_id,workspace_id,status) VALUES ($1,$2,$3,$4)', [`act_${ws}`, `a_${ws}`, ws, 'done']);
  await pool.query('INSERT INTO service_accounts (id,workspace_id,tenant_id,iam_realm,kc_client_id,kc_client_uuid,display_name) VALUES ($1,$2,$3,$4,$5,$6,$7)', [`sa_${ws}`, ws, ten, ten, 'cid', 'uuid', 'sa']);
  await pool.query('INSERT INTO workspace_api_keys (tenant_id,workspace_id,key_type,key_prefix,key_hash,scopes) VALUES ($1,$2,$3,$4,$5,$6)', [ten, ws, 'service', 'flc', 'h', '[]']);
  await pool.query('INSERT INTO async_operations (operation_id,tenant_id,status) VALUES ($1,$2,$3)', [`op_${ws}`, ten, 'completed']);
  await pool.query('INSERT INTO async_operation_transitions (operation_id,tenant_id) VALUES ($1,$2)', [`op_${ws}`, ten]);
}

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  await pool.query(SCHEMA);
  await seed(TEN, WS, 'wsdb_purge_me');
  await seed(OTHER, OWS, 'wsdb_keep_me');
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) { await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {}); await bootstrap.end().catch(() => {}); }
});

const TABLES = ['workspaces', 'workspace_databases', 'workspace_buckets', 'workspace_topics', 'workspace_functions', 'fn_actions', 'service_accounts', 'workspace_api_keys', 'async_operations', 'async_operation_transitions'];

test('purgeTenant removes every owned row + returns the physical resources to tear down', async () => {
  const phys = await store.purgeTenant(pool, TEN);
  assert.deepEqual(phys.databases, ['wsdb_purge_me'], 'returns the wsdb_* to drop');
  assert.deepEqual(phys.buckets, ['bucket-ws_purge']);
  assert.deepEqual(phys.topics, ['phys-ws_purge']);
  assert.deepEqual(phys.ksvcs, ['ksvc-ws_purge']);

  for (const t of [...TABLES, 'fn_activations']) {
    const col = t === 'fn_activations' ? 'workspace_id' : (['workspaces'].includes(t) ? 'tenant_id' : 'tenant_id');
    const val = t === 'fn_activations' ? WS : TEN;
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${t} WHERE ${col} = $1`, [val]);
    assert.equal(rows[0].n, 0, `${t} has no rows for the purged tenant`);
  }
  const { rows: tt } = await pool.query('SELECT count(*)::int n FROM tenants WHERE id=$1', [TEN]);
  assert.equal(tt[0].n, 0, 'the tenant row itself is gone');
});

test('another tenant\'s rows are untouched (no over-deletion)', async () => {
  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${t} WHERE tenant_id = $1`, [OTHER]);
    assert.equal(rows[0].n, 1, `${t} still has the other tenant's row`);
  }
  const { rows } = await pool.query('SELECT count(*)::int n FROM tenants WHERE id=$1', [OTHER]);
  assert.equal(rows[0].n, 1, 'the other tenant survives');
});

test('purge is idempotent (a second run is a no-op, not an error)', async () => {
  const phys = await store.purgeTenant(pool, TEN);
  assert.deepEqual(phys.databases, [], 'nothing left to tear down');
});
