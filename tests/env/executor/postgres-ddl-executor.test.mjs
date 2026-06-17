// Real-Postgres proof for change add-postgres-ddl-execute.
// The adapter's structural/governance SQL plans (CREATE TABLE/COLUMN/INDEX, etc.) were
// built but never executed (the console showed DDL as preview-only). This proves they
// now actually run, transactionally, on the admin connection. Run via tests/env/executor/run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { executePostgresDdl } from '../../../apps/control-plane/src/runtime/postgres-ddl-executor.mjs';
import { ensureDataApiRoles } from './data-api-roles.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'cp_ddl_probe';
const DB = 'appdb';
const SCHEMA = 'app1';
const WS = 'ws_ddl';
const identity = { tenantId: 't_ddl', workspaceId: WS };

let bootstrap;
let admin; // assertion connection
let registry;

function probeUrl() {
  return ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
}

const tableColumns = [
  { columnName: 'id', dataType: 'uuid', nullable: false, constraints: { primaryKey: true } },
  { columnName: 'tenant_id', dataType: 'text', nullable: false },
  { columnName: 'name', dataType: 'text' },
];

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  // A table create now GRANTs to these data-API roles (#494), so they must exist.
  await ensureDataApiRoles(admin);
  const dsn = probeUrl();
  // DDL runs on the admin connection; here both point at the superuser probe DSN.
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn, adminDsn: dsn }) });
});

after(async () => {
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    // Plain (non-FORCE) drop — pools are already ended; FORCE could kill a still-closing
    // local connection, which node:test flags as async-after-teardown. Residue is cleaned by
    // the next run's before() FORCE-drop (fresh process, no live local connection).
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('create schema executes and the schema exists', async () => {
  const res = await executePostgresDdl(registry, {
    resourceKind: 'schema', action: 'create', identity,
    payload: { databaseName: DB, schemaName: SCHEMA },
  });
  assert.equal(res.executed, true);
  const r = await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [SCHEMA]);
  assert.equal(r.rowCount, 1);
});

test('create table executes and the table + columns exist', async () => {
  const res = await executePostgresDdl(registry, {
    resourceKind: 'table', action: 'create', identity,
    payload: { databaseName: DB, schemaName: SCHEMA, tableName: 'items', columns: tableColumns },
  });
  assert.equal(res.executed, true);
  const cols = await admin.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY column_name',
    [SCHEMA, 'items'],
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ['id', 'name', 'tenant_id']);
});

test('add column executes and the column exists', async () => {
  const res = await executePostgresDdl(registry, {
    resourceKind: 'column', action: 'create', identity,
    payload: { databaseName: DB, schemaName: SCHEMA, tableName: 'items', columnName: 'price', dataType: 'integer' },
  });
  assert.equal(res.executed, true);
  const r = await admin.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',
    [SCHEMA, 'items', 'price'],
  );
  assert.equal(r.rowCount, 1);
});

test('create index executes and the index exists', async () => {
  const res = await executePostgresDdl(registry, {
    resourceKind: 'index', action: 'create', identity,
    payload: { databaseName: DB, schemaName: SCHEMA, tableName: 'items', indexName: 'items_name_idx', indexMethod: 'btree', keys: [{ columnName: 'name' }] },
  });
  assert.equal(res.executed, true);
  const r = await admin.query('SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname=$2', [SCHEMA, 'items_name_idx']);
  assert.equal(r.rowCount, 1);
});

test('preview (dryRun) does NOT execute and returns the statements', async () => {
  const res = await executePostgresDdl(registry, {
    resourceKind: 'table', action: 'create', identity,
    payload: { databaseName: DB, schemaName: SCHEMA, tableName: 'preview_only', columns: tableColumns, dryRun: true },
  });
  assert.equal(res.executed, false);
  assert.ok(res.statements.length >= 1 && /CREATE TABLE/i.test(res.statements[0]));
  const r = await admin.query('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2', [SCHEMA, 'preview_only']);
  assert.equal(r.rowCount, 0, 'preview must not create the table');
});

test('invalid DDL (table with no columns) → 400 DDL_INVALID', async () => {
  await assert.rejects(
    () => executePostgresDdl(registry, {
      resourceKind: 'table', action: 'create', identity,
      payload: { databaseName: DB, schemaName: SCHEMA, tableName: 'empty_t', columns: [] },
    }),
    (e) => e.statusCode === 400 && e.code === 'DDL_INVALID',
  );
});

test('duplicate table → 409 (sanitized) and rolled back', async () => {
  await assert.rejects(
    () => executePostgresDdl(registry, {
      resourceKind: 'table', action: 'create', identity,
      payload: { databaseName: DB, schemaName: SCHEMA, tableName: 'items', columns: tableColumns },
    }),
    (e) => e.statusCode === 409 && !/CREATE TABLE|app1/i.test(e.message),
  );
});

test('missing identity → 401', async () => {
  await assert.rejects(
    () => executePostgresDdl(registry, { resourceKind: 'schema', action: 'create', payload: { databaseName: DB, schemaName: 's2' } }),
    (e) => e.statusCode === 401,
  );
});
