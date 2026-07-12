import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoCaptureConfigCache } from '../../src/MongoCaptureConfigCache.mjs';

test('loads and diffs active configs', async () => {
  let rows = [{ id: 'a' }];
  const pool = { query: async () => ({ rows }) };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0 });
  const added = [];
  const removed = [];
  cache.on('added', (row) => added.push(row.id));
  cache.on('removed', (row) => removed.push(row.id));
  await cache.load(true);
  rows = [{ id: 'b' }];
  await cache.load(true);
  assert.deepEqual(added, ['a', 'b']);
  assert.deepEqual(removed, ['a']);
});

test('returns stale cache on db error', async () => {
  let fail = false;
  const pool = { query: async () => { if (fail) throw new Error('boom'); return { rows: [{ id: 'a' }] }; } };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0 });
  await cache.load(true);
  fail = true;
  const rows = await cache.load(true);
  assert.equal(rows.length, 1);
});

test('scopes SQL to tenant_id when tenantId is provided', async () => {
  const queries = [];
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0, tenantId: 'tenant-a' });
  await cache.load(true);
  assert.ok(queries.length > 0, 'expected a query');
  const q = queries[0];
  assert.ok(q.sql.includes('tenant_id'), `SQL must include tenant_id predicate: ${q.sql}`);
  assert.ok(q.params && q.params.includes('tenant-a'), `params must include tenantId: ${JSON.stringify(q.params)}`);
});

test('no-tenantId path enumerates tenants then queries each scoped (no unbounded all-tenants query)', async () => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('DISTINCT tenant_id')) return { rows: [{ tenant_id: 't1' }, { tenant_id: 't2' }] };
    return { rows: [] };
  } };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0 });
  await cache.load(true);
  // First query enumerates active tenants...
  assert.ok(queries[0].sql.includes('DISTINCT tenant_id'), `first query must enumerate tenants: ${queries[0].sql}`);
  // ...then one tenant_id-scoped query per active tenant.
  const scoped = queries.slice(1);
  assert.equal(scoped.length, 2, 'one scoped query per active tenant');
  assert.ok(scoped.every((q) => q.sql.includes('tenant_id = $1') && q.params && q.params.length === 1),
    `each follow-up query must be tenant-scoped: ${JSON.stringify(scoped)}`);
  // No single query loads all tenants' active configs unscoped.
  assert.ok(!queries.some((q) => /SELECT \* FROM mongo_capture_configs WHERE status = 'active'/.test(q.sql)),
    'must not issue an unbounded all-tenants query');
});
