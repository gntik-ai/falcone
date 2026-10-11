import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { idempotencyDatabase } from '../helpers/idempotency-database.mjs';
import { request } from '../helpers/http-request.mjs';

function database() {
  const keys = [];
  const replay = idempotencyDatabase();
  return { async query(sql, values = []) {
    if (sql.includes('INSERT INTO workspace_api_keys')) {
      const row = { id: `key-${keys.length}`, tenant_id: values[0], workspace_id: values[1], key_type: values[2], key_prefix: values[3], scopes: values[5], status: 'active' };
      keys.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM workspace_api_keys')) return { rows: keys.filter(row => row.workspace_id === values[0]), rowCount: keys.length };
    return replay.query(sql, values);
  } };
}
const path = '/v1/workspaces/fixture-workspace/api-keys';
const headers = { 'x-tenant-id': 'fixture-tenant', 'x-auth-subject': 'fixture-user', 'x-actor-roles': 'tenant_owner', 'idempotency-key': 'same-key-123' };

test('a retried credential issuance creates one key and never replays its secret', async () => {
  const pool = database();
  const server = createControlPlaneServer({ registry: {}, apiKeyStore: createApiKeyStore({ pool }), idempotencyPool: pool, logger: { error() {} } });
  const first = await request(server, { path, headers });
  const second = await request(server, { path, headers });
  const listing = await request(server, { method: 'GET', path, headers });
  assert.equal(first.status, 201);
  assert.equal(listing.body.items.length, 1, 'duplicate keyed POST must create exactly one resource');
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
});

test('browsers can read the replay marker on executor responses', async () => {
  const server = createControlPlaneServer({ registry: {} });
  const result = await request(server, { method: 'GET', path: '/healthz' });
  assert.match(result.headers['access-control-expose-headers'] ?? '', /X-Idempotency-Replayed/i);
});

test('executor HTTP: thrown client errors replay their original envelope', async () => {
  const server = createControlPlaneServer({ registry: {}, idempotencyPool: database(), logger: { error() {} } });
  const input = {
    path: '/v1/postgres/databases/fixture/schemas',
    headers: { ...headers, 'x-workspace-id': 'fixture-workspace' }, body: '{"name":"invalid-name"}',
  };
  const first = await request(server, input);
  const second = await request(server, input);
  assert.equal(first.status, 400);
  assert.deepEqual(first.body, { code: 'INVALID_IDENTIFIER', message: 'Invalid schemaName identifier' });
  assert.equal(first.headers['x-idempotency-replayed'], undefined);
  assert.equal(second.status, 400);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers['x-idempotency-replayed'], 'true');
});

test('streaming mutations reject malformed keys before invoking the streaming handler', async () => {
  const server = createControlPlaneServer({ registry: {}, logger: { error() {} } });
  const result = await request(server, {
    path: '/v1/workspaces/fixture-workspace/llm/completions',
    headers: { ...headers, 'idempotency-key': 'bad key' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_IDEMPOTENCY_KEY');
});

test('verified API-key identities include their stable credential ID', async () => {
  const store = createApiKeyStore({ pool: { async query() { return { rowCount: 1, rows: [{ id: 'credential-1', tenant_id: 'tenant-a', workspace_id: 'ws', key_type: 'service', scopes: ['data:write'] }] }; } } });
  assert.equal((await store.verifyKey('flc_service_fixture')).keyId, 'credential-1');
});

function noteServer({ failFirst = false, pause } = {}) {
  const replay = idempotencyDatabase();
  let sequence = 0;
  const pool = { async query(sql, values = []) {
    if (sql.includes('INSERT INTO workspace_docs_service.workspace_doc_notes')) {
      if (pause) await pause;
      if (failFirst) { failFirst = false; throw new Error('fixture database unavailable'); }
      sequence++;
      return { rows: [{ id: `note-${sequence}`, content: values[2], author_id: values[3], created_at: '2026-01-01', updated_at: '2026-01-01' }], rowCount: 1 };
    }
    return replay.query(sql, values);
  } };
  return createControlPlaneServer({ registry: {}, workspaceDocsDb: pool, idempotencyPool: pool, logger: { error() {} } });
}
const notePath = '/v1/workspaces/fixture-workspace/docs/notes';
const noteHeaders = { ...headers, 'x-actor-roles': 'workspace_admin' };

test('executor HTTP: keyed mutations replay, changed bodies mismatch and unkeyed mutations still execute', async () => {
  const server = noteServer();
  const input = { path: notePath, headers: noteHeaders, body: '{"content":"original"}' };
  const first = await request(server, input);
  const second = await request(server, input);
  assert.equal(first.status, 201);
  assert.equal(first.headers['x-idempotency-replayed'], undefined);
  assert.equal(second.status, 201);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers['x-idempotency-replayed'], 'true');
  const mismatch = await request(server, { ...input, body: '{"content":"changed"}' });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.code, 'IDEMPOTENCY_KEY_MISMATCH');
  const { 'idempotency-key': _key, ...unkeyedHeaders } = noteHeaders;
  assert.equal((await request(server, { ...input, headers: unkeyedHeaders })).body.noteId, 'note-2');
  assert.equal((await request(server, { ...input, headers: unkeyedHeaders })).body.noteId, 'note-3');
});

test('executor HTTP: a failed first attempt permits a keyed retry and records final 4xx results', async () => {
  const server = noteServer({ failFirst: true });
  const input = { path: notePath, headers: noteHeaders, body: '{"content":"original"}' };
  assert.equal((await request(server, input)).status, 500);
  assert.equal((await request(server, input)).status, 201);
  assert.equal((await request(server, input)).headers['x-idempotency-replayed'], 'true');
  const denied = { ...input, headers: { ...noteHeaders, 'idempotency-key': 'other-key-123', 'x-actor-roles': 'tenant_owner' } };
  assert.equal((await request(server, denied)).status, 403);
  assert.equal((await request(server, denied)).headers['x-idempotency-replayed'], 'true');
});

test('executor HTTP: concurrent requests have one winner; invalid keys cause no mutation', async () => {
  let unblock;
  const pause = new Promise(resolve => { unblock = resolve; });
  const server = noteServer({ pause });
  const input = { path: notePath, headers: noteHeaders, body: '{"content":"original"}' };
  const original = request(server, input);
  await new Promise(resolve => setImmediate(resolve));
  const inFlight = await request(server, input);
  assert.equal(inFlight.status, 409);
  assert.equal(inFlight.body.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
  assert.equal(inFlight.headers['retry-after'], '1');
  unblock();
  assert.equal((await original).body.noteId, 'note-1');
  assert.equal((await request(server, { ...input, headers: { ...noteHeaders, 'idempotency-key': 'invalid' } })).status, 400);
});

test('executor HTTP: same key for another tenant or subject is independent', async () => {
  const server = noteServer();
  const input = { path: notePath, headers: noteHeaders, body: '{"content":"original"}' };
  assert.equal((await request(server, input)).body.noteId, 'note-1');
  assert.equal((await request(server, { ...input, headers: { ...noteHeaders, 'x-tenant-id': 'other-tenant' } })).body.noteId, 'note-2');
  assert.equal((await request(server, { ...input, headers: { ...noteHeaders, 'x-auth-subject': 'other-subject' } })).body.noteId, 'note-3');
});

test('real flow creation retries do not create another flow', async t => {
  let createFlowExecutor;
  try { ({ createFlowExecutor } = await import('../../apps/control-plane-executor/src/runtime/flow-executor.mjs')); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && process.env.HTTP_IDEMPOTENCY_TEST_REQUIRED !== '1') return t.skip('yaml/ajv dependencies are absent'); throw error; }
  const server = createControlPlaneServer({ registry: {}, flowExecutor: createFlowExecutor(), idempotencyPool: idempotencyDatabase() });
  const input = { path: '/v1/flows/workspaces/fixture-workspace/flows', headers, body: '{"name":"draft"}' };
  const first = await request(server, input);
  const second = await request(server, input);
  assert.equal(first.status, 201);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers['x-idempotency-replayed'], 'true');
  const listing = await request(server, { method: 'GET', path: input.path, headers });
  assert.equal(listing.body.items.length, 1);
});

test('real Kafka executor retries publish only one message', async t => {
  let createEventsExecutor;
  try { ({ createEventsExecutor } = await import('../../apps/control-plane-executor/src/runtime/events-executor.mjs')); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && process.env.HTTP_IDEMPOTENCY_TEST_REQUIRED !== '1') return t.skip('kafkajs dependency is absent'); throw error; }
  const messages = [];
  const kafkaClient = { producer: () => ({ async connect() {}, async send(input) { messages.push(...input.messages); return [{ baseOffset: String(messages.length - 1) }]; } }) };
  const server = createControlPlaneServer({ registry: {}, eventsExecutor: createEventsExecutor({ brokers: 'fixture:9092', kafkaClient }), idempotencyPool: idempotencyDatabase() });
  const input = { path: '/v1/events/workspaces/fixture-workspace/topics/topic/publish', headers, body: '{"value":"message"}' };
  const first = await request(server, input);
  const second = await request(server, input);
  assert.equal(first.status, 202);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers['x-idempotency-replayed'], 'true');
  assert.equal(messages.length, 1);
});

test('executor fall-through forwards every retry untouched for the upstream plane to deduplicate', async t => {
  const { default: http } = await import('node:http');
  const { Writable, Readable } = await import('node:stream');
  const outbound = [];
  const payload = JSON.stringify({ upstream: true });
  t.mock.method(http, 'request', (options, onResponse) => {
    const chunks = [];
    const upstream = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    upstream.setTimeout = () => upstream;
    upstream.on('finish', () => {
      outbound.push({ options, body: Buffer.concat(chunks).toString() });
      const response = Readable.from([payload]);
      response.statusCode = 201;
      response.headers = { 'content-length': Buffer.byteLength(payload), 'content-type': 'application/json' };
      onResponse(response);
    });
    return upstream;
  });
  const server = createControlPlaneServer({ registry: {}, controlPlaneUpstream: 'http://fixture-upstream:8080', idempotencyPool: { query() { throw new Error('Executor must not reserve a proxied request'); } } });
  const input = { path: '/v1/tenants', headers, body: '{"slug":"tenant"}' };
  assert.equal((await request(server, input)).status, 201);
  assert.equal((await request(server, input)).status, 201);
  assert.equal(outbound.length, 2);
  assert.ok(outbound.every(r => r.options.headers['idempotency-key'] === 'same-key-123' && r.body === input.body));
});

test('executor HTTP: malformed JSON is a final 400 response that replays without invoking an action', async () => {
  const server = noteServer();
  const input = { path: notePath, headers: noteHeaders, body: '{' };
  const first = await request(server, input);
  const second = await request(server, input);
  assert.equal(first.status, 400);
  assert.equal(first.body.code, 'INVALID_JSON');
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers['x-idempotency-replayed'], 'true');
});
