// Real-Postgres proof for add-environment-promotion (#641, completes #503/#502): the
// promoteWorkspace handler copies a source workspace's function registry into a target workspace in
// a DIFFERENT environment of the same tenant, leaves the SOURCE registry unchanged, never copies
// secrets/credentials/service-accounts, and is repeatable (a name already in the target is skipped).
// Drives the real LOCAL_HANDLERS.promoteWorkspace against a live Postgres. Run via run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ensureSchema, insertWorkspace, insertFunction, listFunctions } from '../../../apps/control-plane/tenant-store.mjs';
import { LOCAL_HANDLERS } from '../../../apps/control-plane/b-handlers.mjs';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const PROBE_DB = 'cp_promote_probe';
const TEN = 'ten_promote';
const owner = { actorType: 'tenant_owner', tenantId: TEN, sub: 'seed' };
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

let bootstrap; let pool; let dev; let prod;

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await ensureSchema(pool);
  dev = await insertWorkspace(pool, { id: randomUUID(), tenantId: TEN, slug: 'api-dev', displayName: 'API dev', environment: 'dev', createdBy: 'seed' });
  prod = await insertWorkspace(pool, { id: randomUUID(), tenantId: TEN, slug: 'api-prod', displayName: 'API prod', environment: 'prod', createdBy: 'seed' });
  await insertFunction(pool, { id: randomUUID(), workspaceId: dev.id, tenantId: TEN, name: 'fn-a', runtime: 'nodejs:20', handler: 'main', sourceRef: 'gitsha-a', createdBy: 'seed' });
  await insertFunction(pool, { id: randomUUID(), workspaceId: dev.id, tenantId: TEN, name: 'fn-b', runtime: 'python:3.11', handler: 'handler', sourceRef: null, createdBy: 'seed' });
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) { await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {}); await bootstrap.end().catch(() => {}); }
});

test('promote dev -> prod copies the function registry; source unchanged; secrets not copied', async () => {
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: dev.id }, body: { targetEnvironment: 'prod', targetWorkspaceId: prod.id }, identity: owner, pool,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([...res.body.promotion.promoted.functions].sort(), ['fn-a', 'fn-b']);
  assert.ok(res.body.promotion.notCopied.includes('secrets'));
  assert.ok(res.body.promotion.notCopied.includes('credentials'));

  // The TARGET (prod) gained both functions, with the runtime/sourceRef carried across.
  const prodFns = await listFunctions(pool, prod.id);
  const byName = Object.fromEntries(prodFns.items.map((f) => [f.name, f]));
  assert.deepEqual(Object.keys(byName).sort(), ['fn-a', 'fn-b']);
  assert.equal(byName['fn-a'].runtime, 'nodejs:20');
  assert.equal(byName['fn-a'].source_ref, 'gitsha-a');

  // The SOURCE (dev) registry is unchanged (still exactly the two originals).
  const devFns = await listFunctions(pool, dev.id);
  assert.equal(devFns.total, 2, 'source registry was not mutated');
});

test('promotion is repeatable: a second run skips the already-present functions', async () => {
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: dev.id }, body: { targetEnvironment: 'prod', targetWorkspaceId: prod.id }, identity: owner, pool,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.promotion.promoted.functions, []);
  assert.deepEqual([...res.body.promotion.skipped.functions.map((s) => s.name)].sort(), ['fn-a', 'fn-b']);
  // Target still has exactly two functions (no duplicates / no overwrite).
  const prodFns = await listFunctions(pool, prod.id);
  assert.equal(prodFns.total, 2);
});
