// Real-HTTP + real-Postgres proof for the control-plane service (add-control-plane-executor).
// Boots the actual HTTP server, sends requests with gateway-style identity headers, and
// asserts the data-row family works end-to-end (server → executor → adapter plan → Postgres).
// Run via tests/env/executor/run.sh (it also runs the executor unit-of-work test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane/src/runtime/server.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'cp_http_probe';
const APP_LOGIN = 'cp_http_app';
const APP_PW = 'cp_http_local_only';
const TEN_A = 'ten_http_a';
const WS_A = 'ws_http_a';

let bootstrap;
let admin;
let registry;
let server;
let baseUrl;

function probeUrl(role, pw) {
  const base = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  return role ? base.replace(/\/\/[^:]+:[^@]+@/, `//${role}:${pw}@`) : base;
}

const rowsPath = `/v1/postgres/workspaces/${WS_A}/data/appdb/schemas/public/tables/notes/rows`;
const authHeaders = { 'content-type': 'application/json', 'x-tenant-id': TEN_A, 'x-workspace-id': WS_A, 'x-auth-subject': 'user-1' };

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`CREATE TABLE public.notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL, workspace_id text NOT NULL, body text NOT NULL)`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_LOGIN}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO ${APP_LOGIN}`);
  await admin.query(`INSERT INTO public.notes (tenant_id, workspace_id, body) VALUES ($1,$2,'seed-a')`, [TEN_A, WS_A]);

  const appDsn = probeUrl(APP_LOGIN, APP_PW);
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn }) });
  server = createControlPlaneServer({ registry, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('GET /healthz → 200', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('POST rows inserts (tenant stamped) → 201', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ values: { body: 'http-one' } }),
  });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.item.tenant_id, TEN_A);
  assert.equal(out.item.body, 'http-one');
});

test('GET rows lists only the caller tenant rows → 200', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}`, { headers: authHeaders });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.items.length, 2); // seed-a + http-one
  assert.ok(out.items.every((r) => r.tenant_id === TEN_A));
});

test('GET rows without tenant identity → 401', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}`, { headers: { 'content-type': 'application/json' } });
  assert.equal(res.status, 401);
});

test('GET unknown path → 404 NO_ROUTE', async () => {
  const res = await fetch(`${baseUrl}/v1/nope`, { headers: authHeaders });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'NO_ROUTE');
});

test('GET rows on unknown table → 404 TABLE_NOT_FOUND (sanitized)', async () => {
  const res = await fetch(`${baseUrl}/v1/postgres/workspaces/${WS_A}/data/appdb/schemas/public/tables/ghost/rows`, { headers: authHeaders });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'TABLE_NOT_FOUND');
});
