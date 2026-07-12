import test from 'node:test';
import assert from 'node:assert/strict';
import { ResumeTokenStore } from '../../src/ResumeTokenStore.mjs';

test('get returns the stored LSN string, upsert wraps it as {lsn}, delete delegates', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push([sql, params]); return sql.startsWith('SELECT') ? { rows: [{ resume_token: { lsn: '0/1A2B3C4D' } }] } : { rows: [{}] }; } };
  const store = new ResumeTokenStore(pool);
  await store.upsert('c1', '0/1A2B3C4D');
  const lsn = await store.get('c1');
  await store.delete('c1');
  assert.equal(lsn, '0/1A2B3C4D');
  // upsert persists the LSN wrapped in a JSONB envelope {"lsn":"..."}
  assert.deepEqual(JSON.parse(calls[0][1][1]), { lsn: '0/1A2B3C4D' });
  assert.equal(calls.length, 3);
});

test('get returns null when no token is stored', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const store = new ResumeTokenStore(pool);
  assert.equal(await store.get('missing'), null);
});
