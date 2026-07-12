// Real-Postgres proof for fix-quota-consumption-measurement (#497): the consumption resolvers must
// measure each production plan dimension against the LIVE in_falcone tables (workspace_databases,
// workspace_functions, workspace_topics, workspace_api_keys, workspaces) — not the non-existent
// pg_databases/functions/kafka_topics tables the repo used before, which returned
// NO_QUERY_MAPPING / CONSUMPTION_QUERY_FAILED for every dimension on the live stack.
// Run via: PGHOST=localhost PGPORT=55432 PGUSER=falcone PGPASSWORD=falcone node --test <file>
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { resolveDimensionCounts } from '../../packages/provisioning-orchestrator/src/repositories/consumption-repository.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const PROBE_DB = 'cp_quota_probe';
const TEN = 'ten_q'; const OTHER = 'ten_other'; const WS = 'ws_q';
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

let bootstrap; let pool;
// Mirror the live in_falcone schema (the columns the resolvers count on).
const SCHEMA = `
  CREATE TABLE workspaces (id text PRIMARY KEY, tenant_id text, workspace_id text);
  CREATE TABLE workspace_databases (id text PRIMARY KEY, tenant_id text, workspace_id text, engine text);
  CREATE TABLE workspace_functions (id text PRIMARY KEY, tenant_id text, workspace_id text);
  CREATE TABLE workspace_topics (id text PRIMARY KEY, tenant_id text, workspace_id text);
  CREATE TABLE workspace_api_keys (id serial PRIMARY KEY, tenant_id text, workspace_id text);
`;

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  await pool.query(SCHEMA);
  // Tenant under test: 2 workspaces, 3 pg dbs + 1 mongo db, 4 functions, 2 topics, 5 api keys.
  for (let i = 0; i < 2; i++) await pool.query('INSERT INTO workspaces (id,tenant_id,workspace_id) VALUES ($1,$2,$3)', [`w${i}`, TEN, `${WS}${i}`]);
  for (let i = 0; i < 3; i++) await pool.query('INSERT INTO workspace_databases (id,tenant_id,workspace_id,engine) VALUES ($1,$2,$3,$4)', [`pg${i}`, TEN, WS, 'postgresql']);
  await pool.query('INSERT INTO workspace_databases (id,tenant_id,workspace_id,engine) VALUES ($1,$2,$3,$4)', ['mg0', TEN, WS, 'mongodb']);
  for (let i = 0; i < 4; i++) await pool.query('INSERT INTO workspace_functions (id,tenant_id,workspace_id) VALUES ($1,$2,$3)', [`f${i}`, TEN, WS]);
  for (let i = 0; i < 2; i++) await pool.query('INSERT INTO workspace_topics (id,tenant_id,workspace_id) VALUES ($1,$2,$3)', [`t${i}`, TEN, WS]);
  for (let i = 0; i < 5; i++) await pool.query('INSERT INTO workspace_api_keys (tenant_id,workspace_id) VALUES ($1,$2)', [TEN, WS]);
  // Another tenant's rows must NOT be counted.
  await pool.query("INSERT INTO workspace_databases (id,tenant_id,workspace_id,engine) VALUES ('other-pg',$1,'x','postgresql')", [OTHER]);
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) { await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {}); await bootstrap.end().catch(() => {}); }
});

const PROD_DIMENSIONS = ['max_workspaces', 'max_pg_databases', 'max_mongo_databases', 'max_functions', 'max_kafka_topics', 'max_api_keys', 'max_storage_bytes', 'max_workspace_members'];

test('every production dimension is measured against the live tables (no NO_QUERY_MAPPING / FAILED)', async () => {
  const counts = await resolveDimensionCounts(pool, TEN, PROD_DIMENSIONS);
  for (const d of PROD_DIMENSIONS) {
    const entry = counts.get(d);
    assert.ok(entry, `dimension ${d} resolved`);
    assert.equal(entry.usageUnknownReason, null, `${d} is measured (not ${entry.usageUnknownReason})`);
    assert.equal(typeof entry.currentUsage, 'number', `${d} has a numeric usage`);
  }
  assert.equal(counts.get('max_workspaces').currentUsage, 2);
  assert.equal(counts.get('max_pg_databases').currentUsage, 3, 'postgresql dbs only (engine filter)');
  assert.equal(counts.get('max_mongo_databases').currentUsage, 1, 'mongodb dbs only');
  assert.equal(counts.get('max_functions').currentUsage, 4);
  assert.equal(counts.get('max_kafka_topics').currentUsage, 2);
  assert.equal(counts.get('max_api_keys').currentUsage, 5);
  // No control-plane source → measured 0 (documented gap), but NOT an error.
  assert.equal(counts.get('max_storage_bytes').currentUsage, 0);
  assert.equal(counts.get('max_workspace_members').currentUsage, 0);
});

test('counts are tenant-scoped (another tenant\'s rows are not counted)', async () => {
  const counts = await resolveDimensionCounts(pool, OTHER, ['max_pg_databases', 'max_workspaces']);
  assert.equal(counts.get('max_pg_databases').currentUsage, 1, "only the other tenant's own db");
  assert.equal(counts.get('max_workspaces').currentUsage, 0);
});
