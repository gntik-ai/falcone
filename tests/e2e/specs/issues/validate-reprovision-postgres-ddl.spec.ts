/**
 * REAL-stack E2E for change `validate-reprovision-postgres-ddl` (issue #218).
 *
 * Falcone ships as pure-logic libraries with no runnable HTTP app, so the REAL
 * stack here is the backing Postgres booted by `tests/e2e/stack.sh up`
 * (delegates to tests/env). This spec drives the PUBLIC applier entrypoint
 *   apply(tenantId, domainData, { credentials: { pgClient } })
 * against a LIVE Postgres and asserts end-state DB integrity: injection payloads
 * in data_type / column_default / privilege_type / view-definition are rejected
 * with NO DDL reaching the database, while legitimate configs really provision.
 *
 * The view-definition case doubles as the cross-tenant probe: a tenant-A view
 * whose body reads tenant B's schema is a single-statement, real cross-tenant
 * leak that the fix must block (on the unpatched applier the view would be
 * created and tenant A could read tenant B's secret).
 *
 * Connection: env from `source tests/env/env.sh` (DB_URL / PG*), with a fallback
 * to the documented test-env DSN so the spec is runnable standalone.
 */
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { apply } from '../../../../services/provisioning-orchestrator/src/appliers/postgres-applier.mjs';

const { Client } = pg;

const DSN = process.env.DB_URL || 'postgres://falcone:falcone@localhost:55432/falcone_test';
const TENANT_A = process.env.TESTENV_TENANT_A || '11111111-1111-1111-1111-111111111111';
const TENANT_B = process.env.TESTENV_TENANT_B || '22222222-2222-2222-2222-222222222222';
// The applier derives schema = tenantId.replace(/-/g, '_').
const SCHEMA_A = TENANT_A.replace(/-/g, '_');
const SCHEMA_B = TENANT_B.replace(/-/g, '_');
const SECRET_VALUE = 'B-PRIVATE-4242';

/** @type {import('pg').Client} */
let client;

// Shared serial state: one live connection, ordered scenarios.
test.describe.configure({ mode: 'serial' });

/** Run the real applier for tenant A against the live Postgres. */
function reprovision(domainData) {
  return apply(TENANT_A, { schema: SCHEMA_A, ...domainData }, { credentials: { pgClient: client } });
}

function messagesOf(result) {
  return (result.resource_results || []).map((r) => r.message).filter(Boolean).join(' | ');
}

async function relationExists(schema, name) {
  const r = await client.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
    [schema, name],
  );
  return r.rows.length > 0;
}

async function viewExists(schema, name) {
  const r = await client.query(
    'SELECT 1 FROM information_schema.views WHERE table_schema = $1 AND table_name = $2',
    [schema, name],
  );
  return r.rows.length > 0;
}

async function grantExists(schema, table, grantee, privilege) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND table_name = $2 AND grantee = $3 AND privilege_type = $4`,
    [schema, table, grantee, privilege],
  );
  return r.rows.length > 0;
}

test.beforeAll(async () => {
  client = new Client({ connectionString: DSN });
  await client.connect();

  // Fresh, deterministic fixtures. tmpfs makes the DB ephemeral per `up`, but
  // make setup idempotent so the spec is re-runnable within a session.
  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA_A}" CASCADE`);
  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA_B}" CASCADE`);
  await client.query(`CREATE SCHEMA "${SCHEMA_A}"`);
  await client.query(`CREATE SCHEMA "${SCHEMA_B}"`);

  // Sentinel inside tenant A's own schema — an injection's DROP target.
  await client.query(`CREATE TABLE "${SCHEMA_A}".victim (id integer)`);
  await client.query(`INSERT INTO "${SCHEMA_A}".victim VALUES (1)`);

  // Tenant B private data — the cross-tenant leak target.
  await client.query(`CREATE TABLE "${SCHEMA_B}".secret (card text)`);
  await client.query(`INSERT INTO "${SCHEMA_B}".secret VALUES ('${SECRET_VALUE}')`);

  // Grantee role for the valid-GRANT scenario (idempotent).
  await client.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'e2e_reader') THEN
         CREATE ROLE e2e_reader NOLOGIN;
       END IF;
     END $$;`,
  );
});

test.afterAll(async () => {
  if (!client) return;
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA_A}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA_B}" CASCADE`);
  } finally {
    await client.end();
  }
});

// Scenario 1 — non-allowlist data_type is rejected before any DDL.
test('bbx-pg-e2e-01: injection in data_type is rejected; victim table survives, table not created', async () => {
  const payload = `text); DROP TABLE "${SCHEMA_A}".victim; --`;
  const res = await reprovision({
    tables: [{ name: 'inj_type', columns: [{ column_name: 'c', data_type: payload }] }],
  });

  expect(res.status).toBe('error');
  expect(messagesOf(res)).toMatch(/invalid data_type/i); // validation rejection, not a DB error
  expect(await relationExists(SCHEMA_A, 'victim')).toBe(true);
  expect(await relationExists(SCHEMA_A, 'inj_type')).toBe(false);
});

// Scenario 2 — injection payload in column_default is rejected.
test('bbx-pg-e2e-02: injection in column_default is rejected; victim survives, table not created', async () => {
  const res = await reprovision({
    tables: [
      {
        name: 'inj_def',
        columns: [{ column_name: 'c', data_type: 'text', column_default: `'x'); DROP TABLE "${SCHEMA_A}".victim; --` }],
      },
    ],
  });

  expect(res.status).toBe('error');
  expect(messagesOf(res)).toMatch(/unsafe column_default/i);
  expect(await relationExists(SCHEMA_A, 'victim')).toBe(true);
  expect(await relationExists(SCHEMA_A, 'inj_def')).toBe(false);
});

// Scenario 3 — standard types with safe defaults provision for real.
test('bbx-pg-e2e-03: standard types + safe defaults provision the table on the live DB', async () => {
  const res = await reprovision({
    tables: [
      {
        name: 'good_tbl',
        columns: [
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
          { column_name: 'name', data_type: 'text' },
          { column_name: 'created_at', data_type: 'timestamp with time zone', column_default: 'now()' },
        ],
      },
    ],
  });

  expect(res.status).toBe('applied');
  expect(await relationExists(SCHEMA_A, 'good_tbl')).toBe(true);

  const cols = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [SCHEMA_A, 'good_tbl'],
  );
  expect(cols.rows.map((r) => r.column_name).sort()).toEqual(['created_at', 'id', 'name']);
});

// Scenario 4 — non-standard privilege_type is rejected; no GRANT issued.
test('bbx-pg-e2e-04: injection in privilege_type is rejected; victim survives, no grant created', async () => {
  const res = await reprovision({
    grants: [
      { grantee: 'e2e_reader', privilege_type: `SELECT; DROP TABLE "${SCHEMA_A}".victim; --`, table_name: 'victim' },
    ],
  });

  expect(res.status).toBe('error');
  expect(messagesOf(res)).toMatch(/invalid privilege_type/i);
  expect(await relationExists(SCHEMA_A, 'victim')).toBe(true);
  expect(await grantExists(SCHEMA_A, 'victim', 'e2e_reader', 'SELECT')).toBe(false);
});

// Scenario 5 — a recognized privilege provisions the GRANT for real.
test('bbx-pg-e2e-05: recognized SELECT privilege issues the GRANT on the live DB', async () => {
  const res = await reprovision({
    tables: [{ name: 'grant_tbl', columns: [{ column_name: 'id', data_type: 'integer' }] }],
    grants: [{ grantee: 'e2e_reader', privilege_type: 'SELECT', table_name: 'grant_tbl' }],
  });

  expect(res.status).toBe('applied');
  expect(await relationExists(SCHEMA_A, 'grant_tbl')).toBe(true);
  expect(await grantExists(SCHEMA_A, 'grant_tbl', 'e2e_reader', 'SELECT')).toBe(true);
});

// Scenario 6 — CROSS-TENANT PROBE: a tenant-A view whose body reads tenant B's
// data is rejected; no view is created and tenant B's secret stays isolated.
test('bbx-pg-e2e-06: tenant-supplied view definition (cross-tenant read) is rejected; no view created', async () => {
  const leakDefinition = `SELECT card FROM "${SCHEMA_B}".secret`;
  const res = await reprovision({
    views: [{ name: 'leak_view', definition: leakDefinition }],
  });

  expect(res.status).toBe('error');
  expect(messagesOf(res)).toMatch(/not permitted/i);

  // The malicious view must NOT exist in tenant A's schema...
  expect(await viewExists(SCHEMA_A, 'leak_view')).toBe(false);
  // ...so tenant B's secret was never exposed through a tenant-A object.
  expect(await relationExists(SCHEMA_A, 'leak_view')).toBe(false);

  // Sanity: tenant B's data is untouched and remains in its own schema only.
  const secret = await client.query(`SELECT card FROM "${SCHEMA_B}".secret`);
  expect(secret.rows[0].card).toBe(SECRET_VALUE);
});
