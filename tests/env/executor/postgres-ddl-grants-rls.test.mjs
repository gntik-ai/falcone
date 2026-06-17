// Real-Postgres proof for fix-postgres-ddl-grants-and-rls (#494).
// Before the fix, the DDL `create table` path emitted only CREATE TABLE — no GRANT to the
// api-key data roles and no RLS — so the data API returned TABLE_NOT_FOUND for a table it had
// just created (PG-2), and a granted table would leak across tenants (PG-1). This proves the
// DDL→data round-trip now works for the issuing tenant AND the table is tenant-isolated, using
// the real connection registry + executor as a non-BYPASSRLS api-key role. Run via
// tests/env/executor/run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { executePostgresDdl } from '../../../apps/control-plane/src/runtime/postgres-ddl-executor.mjs';
import { executePostgresData } from '../../../apps/control-plane/src/runtime/postgres-data-executor.mjs';
import { ensureDataApiRoles } from './data-api-roles.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'cp_ddl_grants_probe';
const DB = 'appdb';
const SCHEMA = 'app1';
const TABLE = 'secrets';
const TEN_A = 'ten_a';
const WS_A = 'ws_a';
const TEN_B = 'ten_b';
const WS_B = 'ws_b';

let bootstrap;
let admin;
let registry;

const probeUrl = () => ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
const ddlIdentity = (tenantId, workspaceId) => ({ tenantId, workspaceId });
// The data path resolves an api-key to a non-BYPASSRLS role via SET LOCAL ROLE (dbRole).
const svc = (tenantId, workspaceId) => ({
  workspaceId, databaseName: DB, schemaName: SCHEMA, tableName: TABLE,
  identity: { tenantId, workspaceId, dbRole: 'falcone_service', roleName: 'falcone_service' },
});

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await ensureDataApiRoles(admin);
  const dsn = probeUrl(); // superuser login can SET LOCAL ROLE to falcone_service for the data path
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn, adminDsn: dsn }) });

  // Tenant A creates a schema + a table that declares NO tenant column — exactly the live PG-2
  // repro. The DDL path under test must make it usable + isolated on its own.
  await executePostgresDdl(registry, {
    resourceKind: 'schema', action: 'create', workspaceId: WS_A, identity: ddlIdentity(TEN_A, WS_A),
    payload: { databaseName: DB, schemaName: SCHEMA },
  });
  await executePostgresDdl(registry, {
    resourceKind: 'table', action: 'create', workspaceId: WS_A, identity: ddlIdentity(TEN_A, WS_A),
    payload: {
      databaseName: DB, schemaName: SCHEMA, tableName: TABLE,
      columns: [
        { columnName: 'id', dataType: 'int', nullable: false, constraints: { primaryKey: true } },
        { columnName: 'note', dataType: 'text' },
      ],
    },
  });
});

after(async () => {
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('DDL create installs the tenant_id column, api-key grants, and FORCE RLS', async () => {
  const cols = await admin.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY column_name',
    [SCHEMA, TABLE],
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ['id', 'note', 'tenant_id'], 'tenant_id was added');

  const sec = await admin.query(
    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = (quote_ident($1) || '.' || quote_ident($2))::regclass",
    [SCHEMA, TABLE],
  );
  assert.equal(sec.rows[0].relrowsecurity, true, 'RLS enabled');
  assert.equal(sec.rows[0].relforcerowsecurity, true, 'RLS forced (owner is subject too)');

  const pol = await admin.query(
    "SELECT polname FROM pg_policy WHERE polrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass",
    [SCHEMA, TABLE],
  );
  assert.ok(pol.rows.some((r) => r.polname === `${TABLE}_tenant_isolation`), 'tenant isolation policy installed');

  const grants = await admin.query(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema=$1 AND table_name=$2 AND grantee IN ('falcone_service','falcone_anon')`,
    [SCHEMA, TABLE],
  );
  assert.ok(grants.rows.some((r) => r.grantee === 'falcone_service' && r.privilege_type === 'INSERT'), 'service role granted DML');
});

test('create→CRUD round-trip succeeds for the issuing tenant (PG-2 fixed)', async () => {
  const ins = await executePostgresData(registry, { ...svc(TEN_A, WS_A), operation: 'insert', values: { id: 1, note: 'TENANT-A-CONFIDENTIAL' } });
  assert.equal(ins.affected, 1, 'insert via the service role succeeds — no TABLE_NOT_FOUND');
  assert.equal(ins.item.tenant_id, TEN_A, 'tenant stamped on the row');

  const a = await executePostgresData(registry, { ...svc(TEN_A, WS_A), operation: 'list' });
  assert.equal(a.items.length, 1, 'issuing tenant reads its own row back');
  assert.equal(a.items[0].note, 'TENANT-A-CONFIDENTIAL');
});

test('a newly created table is scoped to the issuing tenant (PG-1 closed by RLS)', async () => {
  // Tenant B targets the SAME physical table with its own service identity.
  const bRead = await executePostgresData(registry, { ...svc(TEN_B, WS_B), operation: 'list' });
  assert.equal(bRead.items.length, 0, "tenant B sees none of tenant A's rows");

  // B writes its own row; the two tenants never see each other's data.
  await executePostgresData(registry, { ...svc(TEN_B, WS_B), operation: 'insert', values: { id: 2, note: 'B-ROW' } });
  const aAfter = await executePostgresData(registry, { ...svc(TEN_A, WS_A), operation: 'list' });
  assert.ok(aAfter.items.every((r) => r.note !== 'B-ROW'), 'tenant A never sees B rows');
  const bAfter = await executePostgresData(registry, { ...svc(TEN_B, WS_B), operation: 'list' });
  assert.deepEqual(bAfter.items.map((r) => r.note), ['B-ROW'], 'tenant B sees only its own row');
});
