// fix-workspace-db-provisioning-saga (#502): the data API must route to the workspace's own
// provisioned database (wsdb_*), not the shared control-plane DB. Pure unit coverage of the
// resolver: DSN rewriting, registry lookup, fallback, and caching (stub pool — no real Postgres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dsnWithDatabase, createWorkspaceDsnResolver } from '../../apps/control-plane/src/runtime/workspace-dsn-resolver.mjs';

const BASE = 'postgres://falcone:s3cr3t@falcone-postgresql:5432/in_falcone';

test('dsnWithDatabase swaps only the database, preserving credentials/host/port', () => {
  assert.equal(dsnWithDatabase(BASE, 'wsdb_t_w'), 'postgres://falcone:s3cr3t@falcone-postgresql:5432/wsdb_t_w');
});

test('dsnWithDatabase preserves a query string (e.g. sslmode)', () => {
  assert.equal(
    dsnWithDatabase('postgres://u:p@h:5432/in_falcone?sslmode=disable', 'wsdb_x'),
    'postgres://u:p@h:5432/wsdb_x?sslmode=disable',
  );
});

test('resolveConnection routes a provisioned workspace to its wsdb_* database', async () => {
  let calls = 0;
  const pool = { query: async (_sql, [id]) => { calls++; return { rows: id === 'ws1' ? [{ database_name: 'wsdb_a_one' }] : [] }; } };
  const resolve = createWorkspaceDsnResolver({ pool, baseDsn: BASE });
  // routed:true marks a dedicated wsdb_* (the DDL guard requires it — fix-executor-ddl-db-ownership-guard).
  assert.deepEqual(await resolve('ws1'), { dsn: 'postgres://falcone:s3cr3t@falcone-postgresql:5432/wsdb_a_one', routed: true });
  // Cached: a second lookup does not re-query.
  await resolve('ws1');
  assert.equal(calls, 1, 'positive lookups are cached');
});

test('resolveConnection falls back to the shared DSN for an unprovisioned workspace', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const resolve = createWorkspaceDsnResolver({ pool, baseDsn: BASE });
  // routed:false marks the shared/platform fallback (DDL is refused on it).
  assert.deepEqual(await resolve('ghost'), { dsn: BASE, routed: false });
  assert.deepEqual(await resolve(undefined), { dsn: BASE, routed: false }, 'no workspace → shared DSN');
});

test('resolveConnection fails open to the shared DSN when the registry query throws', async () => {
  const pool = { query: async () => { throw new Error('registry down'); } };
  const resolve = createWorkspaceDsnResolver({ pool, baseDsn: BASE });
  assert.deepEqual(await resolve('ws1'), { dsn: BASE, routed: false }, 'never takes the data plane down');
});

test('invalidate drops a cached mapping', async () => {
  let calls = 0;
  const pool = { query: async () => { calls++; return { rows: [{ database_name: 'wsdb_a_one' }] }; } };
  const resolve = createWorkspaceDsnResolver({ pool, baseDsn: BASE });
  await resolve('ws1');
  resolve.invalidate('ws1');
  await resolve('ws1');
  assert.equal(calls, 2, 're-queries after invalidate');
});
