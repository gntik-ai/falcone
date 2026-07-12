// Real-Postgres proof for change add-pgvector-provisioning-preflight.
//
// The provisioning applier (packages/provisioning-orchestrator/src/appliers/
// postgres-applier.mjs) must query pg_available_extensions BEFORE issuing
// CREATE EXTENSION. pg_available_extensions reflects which extension control
// files the *image* actually ships, so this is a real-DB behaviour that only a
// real Postgres can prove. The tests/env compose Postgres runs the
// pgvector/pgvector:pg16 image (vector available; postgis NOT shipped), which
// gives us both the success and failure paths from a single instance.
//
//   bash tests/env/executor/run.sh        (brings up tests/env Postgres)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { apply } from '../../../packages/provisioning-orchestrator/src/appliers/postgres-applier.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'ext_preflight_probe';

// An extension name guaranteed absent from the pgvector/pgvector image
// (postgis is not bundled by the official postgres / pgvector images).
const ABSENT_EXT = 'postgis';

let bootstrap; // superuser -> default db (create/drop probe db)
let admin; // superuser -> probe db (pre-flight target + introspection)

function probeUrl() {
  return ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
}

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 2 });
});

after(async () => {
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

// Injected query wired to the live probe DB; records every SQL string so we can
// assert that NO CREATE EXTENSION is issued on the failure path.
function instrumentedQuery() {
  const calls = [];
  const query = async (sql, params) => {
    calls.push(sql);
    const res = await admin.query(sql, params);
    return res.rows;
  };
  return { calls, query };
}

async function extInstalled(name) {
  const res = await admin.query('SELECT 1 FROM pg_extension WHERE extname = $1', [name]);
  return res.rows.length > 0;
}

// --- Failure path: unavailable extension is rejected without CREATE EXTENSION ---
test('apply() with an extension absent from pg_available_extensions returns error and issues no CREATE EXTENSION', async () => {
  const { calls, query } = instrumentedQuery();
  const result = await apply('tenant-pf', { schema: 'public', extensions: [{ name: ABSENT_EXT }] }, {
    dryRun: false,
    credentials: { query },
  });

  assert.equal(result.status, 'error');
  const extResult = result.resource_results.find((r) => r.resource_name === ABSENT_EXT);
  assert.ok(extResult, 'a result for the requested extension exists');
  assert.equal(extResult.action, 'error');
  assert.match(extResult.message, new RegExp(ABSENT_EXT));
  assert.ok(
    !calls.some((sql) => /CREATE EXTENSION/i.test(sql)),
    `CREATE EXTENSION must not be issued; saw: ${JSON.stringify(calls)}`,
  );
  assert.equal(await extInstalled(ABSENT_EXT), false, 'extension is not installed in the catalog');
});

// --- Failure message is actionable, not a raw Postgres error / stack trace ----
// (The "vector" image-remedy wording is exercised against an *unavailable*
//  vector by the mocked-query unit tests, since the tests/env image always
//  ships pgvector. Here we assert the real-stack message contract for a
//  genuinely-absent extension: clean, no raw PG error text or stack frames.)
test('unavailable-extension error is a clean config message, not a raw PG error', async () => {
  const { query } = instrumentedQuery();
  const result = await apply('tenant-pf', { schema: 'public', extensions: [{ name: ABSENT_EXT }] }, {
    dryRun: false,
    credentials: { query },
  });
  const extResult = result.resource_results.find((r) => r.resource_name === ABSENT_EXT);
  assert.ok(extResult, 'a result for the requested extension exists');
  assert.doesNotMatch(extResult.message, /could not open extension control file/i);
  assert.doesNotMatch(extResult.message, /\bat .*\.mjs:\d+/, 'no stack frame in the message');
});

// --- Success path: vector IS available -> created, present in pg_extension -----
test('apply() with vector on the pgvector image creates the extension', async () => {
  const { query } = instrumentedQuery();
  const result = await apply('tenant-pf', { schema: 'public', extensions: [{ name: 'vector' }] }, {
    dryRun: false,
    credentials: { query },
  });

  assert.equal(result.status, 'applied');
  const extResult = result.resource_results.find((r) => r.resource_name === 'vector');
  assert.ok(extResult, 'a result for vector exists');
  assert.equal(extResult.action, 'created');

  const row = await admin.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
  assert.equal(row.rows.length, 1, 'vector present in pg_extension');
});

// --- Dry-run pre-flight: unavailable extension reported as error, no DDL -------
test('apply() dry-run with an unavailable extension reports error and issues no CREATE EXTENSION', async () => {
  const { calls, query } = instrumentedQuery();
  const result = await apply('tenant-pf', { schema: 'public', extensions: [{ name: ABSENT_EXT }] }, {
    dryRun: true,
    credentials: { query },
  });

  assert.equal(result.status, 'error');
  const extResult = result.resource_results.find((r) => r.resource_name === ABSENT_EXT);
  assert.ok(extResult, 'a result for the requested extension exists');
  assert.equal(extResult.action, 'error');
  assert.match(extResult.message, new RegExp(ABSENT_EXT));
  assert.ok(
    !calls.some((sql) => /CREATE EXTENSION/i.test(sql)),
    `CREATE EXTENSION must not be issued in dry-run; saw: ${JSON.stringify(calls)}`,
  );
  assert.equal(await extInstalled(ABSENT_EXT), false, 'extension is not installed in the catalog');
});
