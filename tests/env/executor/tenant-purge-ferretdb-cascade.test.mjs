// Real-stack proof for fix-tenant-purge-ferretdb-cascade (#682): tenant purge /
// workspace delete cascade to the FerretDB document store, isolation-safe.
//
// Drives the REAL deploy/kind/control-plane store helpers + mongoTeardown against a
// LIVE Postgres (registry) AND a LIVE FerretDB (the shared document cluster), so the
// cardinal isolation constraint is proven against the actual backend, not a fake:
//   - a tenant's provisioned mongo db is recorded (workspace_mongo_databases) and
//     discoverable by the purge;
//   - purge deletes ONLY that tenant's documents (by {tenantId}) and drops the db
//     when it is empty across ALL tenants;
//   - a same-named SHARED db that still holds ANOTHER tenant's documents is RETAINED
//     (a blind dropDatabase would be cross-tenant data loss).
//
// Run via tests/env/executor/run-ferretdb-cascade.sh (needs Postgres :55432 + FerretDB :57017).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import * as store from '../../../deploy/kind/control-plane/tenant-store.mjs';
import { mongoTeardown } from '../../../deploy/kind/control-plane/mongo-handlers.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/';
const PROBE_DB = 'cp_ferret_purge_probe';
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

// Two tenants sharing a same-named FerretDB database (names are caller-supplied and
// shared across tenants in the one cluster). Unique names per run so re-runs are clean.
const RUN = Date.now().toString(36);
const TEN_PURGE = `ten_ferret_purge_${RUN}`;
const TEN_KEEP = `ten_ferret_keep_${RUN}`;
const WS_PURGE = `ws_ferret_purge_${RUN}`;
const SOLE_DB = `soledb_${RUN}`;     // only TEN_PURGE has docs here -> dropped
const SHARED_DB = `shareddb_${RUN}`; // both tenants have docs here -> retained

let bootstrap; let pool; let mongo;

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  // The REAL schema bootstrap creates workspace_mongo_databases (among others).
  await store.ensureSchema(pool);

  mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await mongo.connect();
  // Seed the shared FerretDB cluster: SOLE_DB has only the purged tenant; SHARED_DB has both.
  await mongo.db(SOLE_DB).collection('orders').insertMany([
    { tenantId: TEN_PURGE, n: 1 }, { tenantId: TEN_PURGE, n: 2 }]);
  await mongo.db(SHARED_DB).collection('records').insertMany([
    { tenantId: TEN_PURGE, n: 1 }, { tenantId: TEN_KEEP, n: 2 }, { tenantId: TEN_PURGE, n: 3 }]);
});

after(async () => {
  // Clean up any FerretDB dbs the test may have left (best-effort).
  try { await mongo?.db(SOLE_DB).dropDatabase(); } catch { /* dropped by the test */ }
  try { await mongo?.db(SHARED_DB).dropDatabase(); } catch { /* */ }
  await mongo?.close().catch(() => {});
  await pool?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('ensureSchema creates workspace_mongo_databases + insert/collect helpers round-trip', async () => {
  // Seed registry rows for the purged tenant's two mongo dbs in one workspace.
  const a = await store.insertMongoDatabase(pool, { workspaceId: WS_PURGE, tenantId: TEN_PURGE, databaseName: SOLE_DB, collections: ['orders'], createdBy: 'tester' });
  const b = await store.insertMongoDatabase(pool, { workspaceId: WS_PURGE, tenantId: TEN_PURGE, databaseName: SHARED_DB, collections: ['records'], createdBy: 'tester' });
  assert.equal(a.database_name, SOLE_DB);
  assert.equal(b.tenant_id, TEN_PURGE);
  // Idempotent: a same (workspace, db) re-provision is a no-op that returns the existing row.
  const again = await store.insertMongoDatabase(pool, { workspaceId: WS_PURGE, tenantId: TEN_PURGE, databaseName: SOLE_DB, collections: ['orders', 'extra'] });
  assert.equal(again.id, a.id, 'ON CONFLICT DO NOTHING returns the existing row (no duplicate)');
  const { rows } = await pool.query('SELECT count(*)::int n FROM workspace_mongo_databases WHERE tenant_id=$1', [TEN_PURGE]);
  assert.equal(rows[0].n, 2, 'exactly two distinct rows recorded');
  // Collect-by-tenant and collect-by-workspace expose both db names.
  assert.deepEqual((await store.collectTenantMongoDatabases(pool, TEN_PURGE)).sort(), [SHARED_DB, SOLE_DB].sort());
  assert.deepEqual((await store.collectWorkspaceMongoDatabases(pool, WS_PURGE)).sort(), [SHARED_DB, SOLE_DB].sort());
});

test('mongoTeardown drops the sole-tenant db and RETAINS the shared db (cross-tenant safety)', async () => {
  const names = await store.collectTenantMongoDatabases(pool, TEN_PURGE);
  const out = await mongoTeardown({ client: mongo, tenantId: TEN_PURGE, databaseNames: names });

  // SOLE_DB: only the purged tenant had data -> physically dropped.
  assert.ok(out.dropped.includes(SOLE_DB), `SOLE_DB must be dropped; got ${JSON.stringify(out)}`);
  // SHARED_DB: another tenant still has data -> retained.
  assert.ok(out.retained.includes(SHARED_DB), `SHARED_DB must be retained; got ${JSON.stringify(out)}`);

  // Verify against the LIVE cluster: SOLE_DB is gone; SHARED_DB survives with ONLY the other tenant.
  const adminDbs = (await mongo.db('admin').admin().listDatabases()).databases.map((d) => d.name);
  assert.ok(!adminDbs.includes(SOLE_DB), 'SOLE_DB no longer exists in the FerretDB cluster');
  const purgedRemaining = await mongo.db(SHARED_DB).collection('records').countDocuments({ tenantId: TEN_PURGE });
  assert.equal(purgedRemaining, 0, 'purged tenant documents removed from the shared db');
  const keepRemaining = await mongo.db(SHARED_DB).collection('records').countDocuments({ tenantId: TEN_KEEP });
  assert.equal(keepRemaining, 1, 'the OTHER tenant document is intact in the shared db (no data loss)');
});

test('purgeTenant removes the workspace_mongo_databases rows for the tenant', async () => {
  const phys = await store.purgeTenant(pool, TEN_PURGE);
  // The collected mongo dbs are surfaced to the caller for teardown.
  assert.deepEqual([...phys.mongoDatabases].sort(), [SHARED_DB, SOLE_DB].sort());
  const { rows } = await pool.query('SELECT count(*)::int n FROM workspace_mongo_databases WHERE tenant_id=$1', [TEN_PURGE]);
  assert.equal(rows[0].n, 0, 'registry rows removed by purge');
});
