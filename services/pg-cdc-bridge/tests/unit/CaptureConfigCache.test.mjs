import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureConfigCache } from '../../src/CaptureConfigCache.mjs';
test('cache behaviors', async () => {
  let calls = 0; let rows = [{ id: 1 }];
  const pool = { query: async () => { calls += 1; return { rows }; } };
  const cache = new CaptureConfigCache({ pool, ttlSeconds: 0.01 });
  assert.equal((await cache.getActiveConfigs('db', 'tenant-a')).length, 1);
  assert.equal((await cache.getActiveConfigs('db', 'tenant-a')).length, 1);
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 15));
  await cache.getActiveConfigs('db', 'tenant-a');
  assert.equal(calls, 2);
  cache.invalidate('db', 'tenant-a');
  await cache.getActiveConfigs('db', 'tenant-a');
  assert.equal(calls, 3);
});
test('db error returns stale or empty', async () => {
  let fail = false; const pool = { query: async () => { if (fail) throw new Error('boom'); return { rows: [{ id: 1 }] }; } };
  const cache = new CaptureConfigCache({ pool, ttlSeconds: 0 });
  assert.equal((await cache.getActiveConfigs('db', 'tenant-a')).length, 1);
  fail = true;
  assert.equal((await cache.getActiveConfigs('db', 'tenant-a')).length, 1);
  const empty = new CaptureConfigCache({ pool: { query: async () => { throw new Error('x'); } }, ttlSeconds: 0 });
  assert.deepEqual(await empty.getActiveConfigs('db', 'tenant-a'), []);
});
test('SQL includes tenant_id predicate', async () => {
  const queries = [];
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
  const cache = new CaptureConfigCache({ pool, ttlSeconds: 0 });
  await cache.getActiveConfigs('db1', 'tenant-a');
  assert.ok(queries[0].sql.includes('tenant_id'), `SQL must include tenant_id: ${queries[0].sql}`);
  assert.ok(queries[0].params.includes('tenant-a'), `params must include tenantId: ${JSON.stringify(queries[0].params)}`);
});
