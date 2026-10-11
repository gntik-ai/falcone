import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveHttpRequest, requestFingerprint } from '../../packages/internal-contracts/src/http-idempotency.mjs';
import { idempotencyDatabase } from '../helpers/idempotency-database.mjs';

function args(pool, overrides = {}) {
  return { pool, key: 'same-key-123', method: 'POST', url: '/v1/flows/workspaces/ws/flows', rawBody: Buffer.from('{"name":"flow"}'), tenantId: 'tenant-a', principalId: 'subject-a', ...overrides };
}
async function complete(pool, overrides = {}, result = {}) {
  const session = await reserveHttpRequest(args(pool, overrides));
  await session.complete({ statusCode: 201, body: { id: 'flow-1' }, ...result });
  return session;
}

test('responses containing credential material cannot be persisted even on a newly added route', async () => {
  const pool = idempotencyDatabase();
  await complete(pool, {}, { body: { connection: { password: 'fixture-secret' } } });
  const next = await reserveHttpRequest(args(pool));
  assert.equal(next.response.statusCode, 409);
  assert.equal(next.response.body.code, 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
  assert.equal([...pool.records.values()][0].response_body, null);
});

test('invalid keys are rejected before dispatch, while no key, GET, public and streaming routes bypass', async () => {
  const pool = idempotencyDatabase();
  for (const key of ['', 'short', 'a'.repeat(129), 'contains space', ['same-key-123']]) {
    assert.equal((await reserveHttpRequest(args(pool, { key }))).response.statusCode, 400);
  }
  for (const overrides of [{ key: undefined }, { method: 'GET', key: 'invalid' }, { route: { auth: 'public' } }, { route: { sse: true } }, { route: { stream: true } }, { route: { proxy: true } }]) {
    assert.equal(await reserveHttpRequest(args(pool, overrides)), null);
  }
  assert.equal(pool.records.size, 0);
});

test('excluded mutations still reject malformed keys without reserving them', async () => {
  const pool = idempotencyDatabase();
  for (const route of [{ auth: 'public' }, { noAuth: true }, { stream: true }, { sse: true }, { webhook: true }]) {
    const result = await reserveHttpRequest(args(pool, { key: 'bad key', route }));
    assert.equal(result?.response?.statusCode, 400);
    assert.equal(result.response.body.code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal(await reserveHttpRequest(args(pool, { route })), null);
  }
  assert.equal(pool.records.size, 0);
});

test('completed success and client-error responses replay exact status and body with only safe headers', async () => {
  for (const statusCode of [201, 422]) {
    const pool = idempotencyDatabase();
    const body = statusCode === 201 ? { id: 'flow-1' } : { code: 'INVALID_FLOW' };
    await complete(pool, {}, { statusCode, body, headers: { ETag: '"flow-1"', Location: '/flows/flow-1', 'Set-Cookie': 'fixture-cookie', Authorization: 'fixture-auth', 'X-Api-Key': 'fixture-key' } });
    const replay = (await reserveHttpRequest(args(pool))).response;
    assert.equal(replay.statusCode, statusCode);
    assert.deepEqual(replay.body, body);
    assert.deepEqual(replay.headers, { etag: '"flow-1"', location: '/flows/flow-1', 'X-Idempotency-Replayed': 'true' });
  }
});

test('an atomic reservation blocks concurrent identical requests and rejects changed body, method or path', async () => {
  const pool = idempotencyDatabase();
  const sessions = await Promise.all(Array.from({ length: 20 }, () => reserveHttpRequest(args(pool))));
  assert.equal(sessions.filter(s => s.complete).length, 1);
  for (const session of sessions.filter(s => s.response)) {
    assert.equal(session.response.statusCode, 409);
    assert.equal(session.response.body.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
    assert.equal(session.response.headers['Retry-After'], '1');
  }
  for (const overrides of [{ rawBody: Buffer.from('{"name":"other"}') }, { method: 'PUT' }, { url: '/v1/events/workspaces/ws/topics/topic/publish' }]) {
    const replay = (await reserveHttpRequest(args(pool, overrides))).response;
    assert.equal(replay.statusCode, 422);
    assert.equal(replay.body.code, 'IDEMPOTENCY_KEY_MISMATCH');
  }
});

test('different tenants and verified principals never cross-replay', async () => {
  const pool = idempotencyDatabase();
  await complete(pool);
  for (const overrides of [{ tenantId: 'tenant-b' }, { principalId: 'subject-b' }]) {
    const next = await reserveHttpRequest(args(pool, overrides));
    assert.equal(next.response, undefined);
    await next.complete({ statusCode: 201, body: { id: 'independent-flow' } });
    assert.equal((await reserveHttpRequest(args(pool, overrides))).response.body.id, 'independent-flow');
  }
  assert.equal((await reserveHttpRequest(args(pool))).response.body.id, 'flow-1');
});

test('both HTTP identity shapes share subject scope and API credentials have independent scope', async () => {
  const pool = idempotencyDatabase();
  const input = args(pool, { tenantId: undefined, principalId: undefined });
  const first = await reserveHttpRequest({ ...input, identity: { tenantId: 'tenant-a', sub: 'user-a' } });
  assert.equal(typeof first.complete, 'function');
  await first.complete({ statusCode: 201, body: { id: 'flow-1' } });
  const replay = await reserveHttpRequest({ ...input, identity: { tenantId: 'tenant-a', actorId: 'user-a' } });
  assert.equal(replay.response.body.id, 'flow-1');
  for (const identity of [{ tenantId: 'tenant-b', sub: 'user-a' }, { tenantId: 'tenant-a', sub: 'user-b' }, { tenantId: 'tenant-a', actorId: 'user-a', keyId: 'user-a' }]) {
    const independent = await reserveHttpRequest({ ...input, identity });
    assert.equal(typeof independent.complete, 'function');
    await independent.release();
  }
});

test('5xx responses and thrown attempts release reservations for a new execution', async () => {
  const pool = idempotencyDatabase();
  await complete(pool, {}, { statusCode: 503, body: { code: 'UNAVAILABLE' } });
  const retry = await reserveHttpRequest(args(pool));
  assert.equal(retry.response, undefined);
  await retry.release(); // HTTP dispatchers release on a thrown handler.
  assert.equal((await reserveHttpRequest(args(pool))).response, undefined);
});

test('the 24h expiry boundary permits a new execution and stale owners cannot overwrite it', async () => {
  let now = 0;
  const pool = idempotencyDatabase({ clock: () => now });
  const first = await complete(pool);
  now = 86399999;
  assert.equal((await reserveHttpRequest(args(pool))).response.body.id, 'flow-1');
  now = 86400000;
  const next = await reserveHttpRequest(args(pool));
  assert.equal(next.response, undefined);
  await first.release();
  await next.complete({ statusCode: 201, body: { id: 'flow-2' } });
  assert.equal((await reserveHttpRequest(args(pool))).response.body.id, 'flow-2');
});

test('secret routes and oversized responses block reexecution without persisting their bodies', async () => {
  for (const overrides of [{ url: '/v1/workspaces/ws/api-keys' }, { url: '/v1/workspaces/ws/database' }, { route: { idempotencyReplay: false } }, { maxResponseBytes: 1 }]) {
    const pool = idempotencyDatabase();
    await complete(pool, overrides);
    assert.equal((await reserveHttpRequest(args(pool, overrides))).response.body.code, 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
    assert.equal([...pool.records.values()][0].response_body, null);
  }
});

test('fingerprints preserve raw bytes and normalize the request target without dropping query selectors', () => {
  const body = Buffer.from('{"name":"flow"}');
  assert.equal(requestFingerprint('POST', '/v1/flows/', body), requestFingerprint('POST', '/v1/flows', body));
  assert.notEqual(requestFingerprint('POST', '/v1/flows', body), requestFingerprint('POST', '/v1/flows', Buffer.from('{ "name": "flow" }')));
  assert.notEqual(requestFingerprint('POST', '/v1/flows?id=1', body), requestFingerprint('POST', '/v1/flows?id=2', body));
});

test('a response persistence failure keeps the side effect reserved', async () => {
  const database = idempotencyDatabase();
  const pool = { async query(sql, values) { if (sql.includes('UPDATE public.http_idempotency_records')) throw new Error('fixture database outage'); return database.query(sql, values); } };
  const session = await reserveHttpRequest(args(pool));
  await assert.rejects(session.complete({ statusCode: 201, body: { id: 'flow-1' } }), /fixture database outage/);
  await session.release();
  assert.equal((await reserveHttpRequest(args(pool))).response.body.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
});

test('key validation rejects a trailing newline rather than accepting the regex end-of-line match', async () => {
  const result = await reserveHttpRequest(args(idempotencyDatabase(), { key: 'same-key-123\n' }));
  assert.equal(result.response?.statusCode, 400);
});

test('one-time tokens in otherwise ordinary responses are never persisted', async () => {
  const pool = idempotencyDatabase();
  await complete(pool, {}, { body: { token: 'fixture-one-time-token' } });
  assert.equal((await reserveHttpRequest(args(pool))).response.body.code, 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
  assert.equal([...pool.records.values()][0].response_body, null);
});
