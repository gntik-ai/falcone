// Real-Postgres proof for Phase 2: add-app-api-keys + add-console-rls-policies.
// Demonstrates the safe-frontend-access story end-to-end:
//   issue an ANON key -> verify resolves it to a restricted DB role ->
//   author an RLS policy via the DDL governance path -> a query made with the anon key
//   is filtered to the key's tenant (RLS enforced against the assumed role).
// Run via tests/env/executor/run.sh (real Postgres).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createApiKeyStore } from '../../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { executePostgresData } from '../../../apps/control-plane-executor/src/runtime/postgres-data-executor.mjs';
import { executePostgresDdl } from '../../../apps/control-plane-executor/src/runtime/postgres-ddl-executor.mjs';
import { ensureDataApiRoles } from './data-api-roles.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'cp_keys_probe';
const DB = 'appdb';
const TEN_A = 'ten_k_a';
const WS_A = 'ws_k_a';
const TEN_B = 'ten_k_b';
const WS_B = 'ws_k_b';

let bootstrap;
let admin;
let registry;
let keyStore;

const probeUrl = () => ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 3 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // Non-superuser, non-BYPASSRLS roles the keys resolve to (RLS applies to them).
  // Ensure-create (no DROP): these are now a shared fixture across the executor suite (#494),
  // so a per-file DROP+CREATE would race with a sibling file granting to the same role.
  await ensureDataApiRoles(admin);
  for (const role of ['falcone_anon', 'falcone_service']) {
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  }

  await admin.query(`CREATE TABLE public.notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL, workspace_id text NOT NULL, body text NOT NULL)`);
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO falcone_anon, falcone_service');
  await admin.query(`INSERT INTO public.notes (tenant_id, workspace_id, body) VALUES ($1,$2,'a-one'),($1,$2,'a-two'),($3,$4,'b-one')`, [TEN_A, WS_A, TEN_B, WS_B]);

  const dsn = probeUrl(); // superuser login can SET ROLE to the anon/service roles
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn, adminDsn: dsn }) });
  keyStore = createApiKeyStore({ pool: admin });
  await keyStore.ensureSchema();
});

after(async () => {
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    // Pools to PROBE_DB are fully ended above; use a plain (non-FORCE) drop so we never
    // force-kill a local connection that is still closing — node:test would flag that as
    // "async activity after the test ended". Any residue is FORCE-dropped by the next run's
    // before() hook, which runs in a fresh process where no live local connection exists.
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

// ---- 2a: API key store ----
test('issue anon + service keys; plaintext returned once, hashed at rest', async () => {
  const anon = await keyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'anon' });
  const svc = await keyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'service' });
  assert.ok(anon.key.startsWith('flc_anon_'));
  assert.ok(svc.key.startsWith('flc_service_'));
  // the stored row must not contain the plaintext
  const stored = await admin.query('SELECT key_hash FROM workspace_api_keys WHERE id = $1', [anon.id]);
  assert.ok(stored.rows[0].key_hash && !stored.rows[0].key_hash.includes(anon.key));
});

test('verifyKey resolves to the right tenant + DB role; unknown key → null', async () => {
  const { key } = await keyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'anon' });
  const id = await keyStore.verifyKey(key);
  assert.equal(id.tenantId, TEN_A);
  assert.equal(id.keyType, 'anon');
  assert.equal(id.dbRole, 'falcone_anon');
  assert.equal(await keyStore.verifyKey('flc_anon_bogus'), null);
});

test('revoke and rotate invalidate the old key', async () => {
  const issued = await keyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'service' });
  await keyStore.revokeKey({ id: issued.id, workspaceId: WS_A });
  assert.equal(await keyStore.verifyKey(issued.key), null, 'revoked key no longer verifies');

  const k2 = await keyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'anon' });
  const rotated = await keyStore.rotateKey({ id: k2.id, workspaceId: WS_A });
  assert.equal(await keyStore.verifyKey(k2.key), null, 'rotated-away key invalid');
  assert.ok(await keyStore.verifyKey(rotated.key), 'new rotated key valid');
});

// ---- 2b: author an RLS policy via the DDL governance path ----
test('create RLS policy via the DDL executor enables + forces RLS and adds the policy', async () => {
  const res = await executePostgresDdl(registry, {
    resourceKind: 'policy', action: 'create', identity: { tenantId: TEN_A, workspaceId: WS_A },
    payload: {
      databaseName: DB, schemaName: 'public', tableName: 'notes', policyName: 'notes_tenant_isolation',
      command: 'all', mode: 'permissive', roles: ['public'], autoEnableRls: true, forceRls: true,
      usingExpression: "tenant_id = current_setting('app.tenant_id', true)",
      withCheckExpression: "tenant_id = current_setting('app.tenant_id', true)",
    },
  });
  assert.equal(res.executed, true);
  const pol = await admin.query("SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notes' AND policyname='notes_tenant_isolation'");
  assert.equal(pol.rowCount, 1);
  const sec = await admin.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='notes'");
  assert.equal(sec.rows[0].relrowsecurity, true);
  assert.equal(sec.rows[0].relforcerowsecurity, true);
});

// ---- integration: an anon key sees only its tenant's rows ----
test('a query made with an ANON key is RLS-filtered to the key tenant', async () => {
  const { key } = await keyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'anon' });
  const identity = await keyStore.verifyKey(key); // {tenantId:A, dbRole:'falcone_anon', ...}

  const res = await executePostgresData(registry, {
    workspaceId: WS_A, databaseName: DB, schemaName: 'public', tableName: 'notes', operation: 'list', identity,
  });
  assert.equal(res.items.length, 2, 'anon key (tenant A) sees only A rows');
  assert.ok(res.items.every((r) => r.tenant_id === TEN_A));
});

test('pure DB RLS: SET ROLE falcone_anon + unscoped SELECT is filtered by the policy', async () => {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE falcone_anon');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_B]);
    const r = await c.query('SELECT tenant_id FROM public.notes'); // no WHERE
    await c.query('COMMIT');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].tenant_id, TEN_B, 'DB RLS alone filters to the GUC tenant');
  } finally {
    c.release();
  }
});
