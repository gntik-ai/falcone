// Real-Postgres proof for add-environment-first-class-isolation (#503): the workspace `environment`
// field is first-class (persisted + queryable), and a tenant's environments can be listed — each
// with its own workspaces and isolated per-workspace databases (D2/#502). Run via run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ensureSchema, insertWorkspace, insertWorkspaceDatabase, listTenantEnvironments, getWorkspace } from '../../../deploy/kind/control-plane/tenant-store.mjs';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const PROBE_DB = 'cp_env_probe';
const TEN = 'ten_env';
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

let bootstrap; let pool;

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  // gen_random_uuid() default on workspace_buckets needs pgcrypto.
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await ensureSchema(pool);
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) { await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {}); await bootstrap.end().catch(() => {}); }
});

test('workspace environment is first-class: persisted on create and read back', async () => {
  const ws = await insertWorkspace(pool, { id: randomUUID(), tenantId: TEN, slug: 'api-prod', displayName: 'API prod', environment: 'prod', createdBy: 'seed' });
  assert.equal(ws.environment, 'prod', 'environment persisted on insert');
  const fetched = await getWorkspace(pool, ws.id);
  assert.equal(fetched.environment, 'prod', 'environment read back via getWorkspace');
});

test('default environment is dev when unspecified', async () => {
  const ws = await insertWorkspace(pool, { id: randomUUID(), tenantId: TEN, slug: 'api-default', displayName: 'API default', createdBy: 'seed' });
  assert.equal(ws.environment, 'dev');
});

test('a tenant holds multiple environments, each with isolated workspaces + databases', async () => {
  // prod already created above (api-prod). Add staging + dev, each with a provisioned DB.
  const staging = await insertWorkspace(pool, { id: randomUUID(), tenantId: TEN, slug: 'api-staging', displayName: 'API staging', environment: 'staging', createdBy: 'seed' });
  await insertWorkspaceDatabase(pool, { id: randomUUID(), workspaceId: staging.id, tenantId: TEN, engine: 'postgresql', databaseName: 'wsdb_ten_env_api_staging', mode: 'shared', username: 'falcone', host: 'h', port: 5432, environment: 'staging', createdBy: 'seed' });
  // (api-prod from test 1 + api-default 'dev' from test 2 also count.)
  const prodWs = await getWorkspace(pool, 'api-prod');
  await insertWorkspaceDatabase(pool, { id: randomUUID(), workspaceId: prodWs.id, tenantId: TEN, engine: 'postgresql', databaseName: 'wsdb_ten_env_api_prod', mode: 'shared', username: 'falcone', host: 'h', port: 5432, environment: 'prod', createdBy: 'seed' });

  const envs = await listTenantEnvironments(pool, TEN);
  const byName = Object.fromEntries(envs.map((e) => [e.environment, e]));
  assert.deepEqual(Object.keys(byName).sort(), ['dev', 'prod', 'staging'], 'three first-class environments listed');
  assert.equal(byName.prod.workspaceCount, 1);
  // Each environment's database is distinct (isolated resource set per environment).
  assert.equal(byName.prod.workspaces[0].database, 'wsdb_ten_env_api_prod');
  assert.equal(byName.staging.workspaces[0].database, 'wsdb_ten_env_api_staging');
  assert.notEqual(byName.prod.workspaces[0].database, byName.staging.workspaces[0].database, 'prod and staging have isolated databases');
});
