import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { reserveHttpRequest } from '../../packages/internal-contracts/src/http-idempotency.mjs';
import { purgeTenant } from '../../apps/control-plane/tenant-store.mjs';

test('Postgres: concurrent reservations, expiry, stale owners and tenant purge', async t => {
  const dsn = process.env.HTTP_IDEMPOTENCY_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!dsn) return t.skip('HTTP_IDEMPOTENCY_TEST_DATABASE_URL and TEST_DATABASE_URL are absent; a dedicated real Postgres is required');
  let pg;
  try { pg = (await import('pg')).default; }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') return t.skip('pg dependency is not installed'); throw error; }
  const pool = new pg.Pool({ connectionString: dsn });
  const tenantId = `http-idempotency-test-${randomUUID()}`;
  const otherTenant = `${tenantId}-other`;
  const args = { pool, tenantId, principalId: 'fixture-user', key: 'same-key-123', method: 'POST', url: '/v1/flows/workspaces/ws/flows', rawBody: Buffer.from('{}') };
  try {
    await pool.query(await readFile('packages/provisioning-orchestrator/src/migrations/124-http-idempotency.sql', 'utf8'));
    const sessions = await Promise.all(Array.from({ length: 20 }, () => reserveHttpRequest(args)));
    const winners = sessions.filter(session => session.complete);
    assert.equal(winners.length, 1);
    assert.ok(sessions.filter(s => s.response).every(s => s.response.statusCode === 409));
    await winners[0].complete({ statusCode: 201, body: { id: 'flow-1' } });
    assert.equal((await reserveHttpRequest(args)).response.body.id, 'flow-1');
    await pool.query("UPDATE public.http_idempotency_records SET expires_at=clock_timestamp() - interval '1 second' WHERE tenant_id=$1", [tenantId]);
    const renewed = await reserveHttpRequest(args);
    assert.equal(renewed.response, undefined);
    await winners[0].complete({ statusCode: 201, body: { id: 'stale-flow' } });
    assert.equal((await reserveHttpRequest(args)).response.body.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
    await renewed.complete({ statusCode: 201, body: { id: 'flow-2' } });
    const independent = await reserveHttpRequest({ ...args, tenantId: otherTenant });
    await independent.complete({ statusCode: 201, body: { id: 'other-flow' } });
    await purgeTenant(pool, tenantId);
    const fresh = await reserveHttpRequest(args);
    assert.equal(fresh.response, undefined);
    await fresh.release();
    assert.equal((await reserveHttpRequest({ ...args, tenantId: otherTenant })).response.body.id, 'other-flow');
  } finally {
    await pool.query('DELETE FROM public.http_idempotency_records WHERE tenant_id = ANY($1)', [[tenantId, otherTenant]]).catch(() => {});
    await pool.end();
  }
});
