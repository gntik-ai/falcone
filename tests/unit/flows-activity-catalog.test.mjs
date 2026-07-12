// Unit tests for each first-party activity: success envelope, error classification, size
// caps, and tenant-scoping of the executor identity (change: add-flows-activity-catalog /
// #360, tasks 3-9). Pure unit — injected executor/http doubles, no live infra.
import test from 'node:test';
import assert from 'node:assert/strict';

import { dbQuery } from '../../apps/workflow-worker/src/activities/db-query.mjs';
import { storagePut } from '../../apps/workflow-worker/src/activities/storage-put.mjs';
import { storageGet } from '../../apps/workflow-worker/src/activities/storage-get.mjs';
import { functionsInvoke } from '../../apps/workflow-worker/src/activities/functions-invoke.mjs';
import { eventsPublish } from '../../apps/workflow-worker/src/activities/events-publish.mjs';
import { httpRequest } from '../../apps/workflow-worker/src/activities/http-request.mjs';
import { emailSend } from '../../apps/workflow-worker/src/activities/email-send.mjs';

const tenant = { tenantId: 't-A', workspaceId: 'w-A' };

function clientError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// -- db.query ----------------------------------------------------------------------------

test('db.query: postgres insert carries falcone_service role + tenantId; returns success', async () => {
  let seenIdentity;
  const out = await dbQuery(
    { params: { engine: 'postgres', operation: 'insert', databaseName: 'd', schemaName: 'public', tableName: 'items', values: { name: 'x' } }, tenant },
    {
      pgRegistry: {},
      executePostgresData: async (_reg, p) => { seenIdentity = p.identity; return { item: { id: 1, name: 'x' } }; },
    },
  );
  assert.equal(out.status, 'success');
  assert.deepEqual(out.result.item, { id: 1, name: 'x' });
  assert.equal(seenIdentity.dbRole, 'falcone_service');
  assert.equal(seenIdentity.tenantId, 't-A');
  assert.equal(seenIdentity.workspaceId, 'w-A');
});

test('db.query: empty list result passes through without error', async () => {
  const out = await dbQuery(
    { params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 'public', tableName: 'items' }, tenant },
    { pgRegistry: {}, executePostgresData: async () => ({ items: [] }) },
  );
  assert.deepEqual(out.result, { items: [] });
});

test('db.query: undefined-table executor error → non-retryable SCHEMA_ERROR', async () => {
  try {
    await dbQuery(
      { params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 'public', tableName: 'nope' }, tenant },
      { pgRegistry: {}, executePostgresData: async () => { throw clientError('relation does not exist', 400, 'UNDEFINED_TABLE'); } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'SCHEMA_ERROR');
    assert.equal(err.nonRetryable, true);
  }
});

test('db.query: connection timeout → retryable', async () => {
  try {
    await dbQuery(
      { params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 'public', tableName: 'items' }, tenant },
      { pgRegistry: {}, executePostgresData: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.nonRetryable, false);
  }
});

test('db.query: routes mongo engine to executeMongoData', async () => {
  let called = false;
  const out = await dbQuery(
    { params: { engine: 'mongo', operation: 'list', databaseName: 'd', collectionName: 'c' }, tenant },
    { executeMongoData: async (p) => { called = true; assert.equal(p.identity.tenantId, 't-A'); return { items: [] }; } },
  );
  assert.ok(called);
  assert.equal(out.status, 'success');
});

// -- storage.put / storage.get -----------------------------------------------------------

test('storage.put: 200 → success with etag', async () => {
  const out = await storagePut(
    { params: { bucketId: 'b1', objectKey: 'uploads/f.txt', body: Buffer.from('hi').toString('base64'), contentType: 'text/plain' }, tenant, credential: { apiKey: 'k', baseUrl: 'http://cp' } },
    { http: async () => ({ status: 200, headers: new Map([['etag', 'abc']]) }) },
  );
  assert.equal(out.status, 'success');
  assert.equal(out.objectKey, 'uploads/f.txt');
  assert.equal(out.etag, 'abc');
});

test('storage.put: 403 cross-workspace → non-retryable FORBIDDEN', async () => {
  try {
    await storagePut(
      { params: { bucketId: 'b2', objectKey: 'k', body: 'AAAA' }, tenant, credential: {} },
      { http: async () => ({ status: 403 }) },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'FORBIDDEN');
    assert.equal(err.nonRetryable, true);
  }
});

test('storage.put: network error → retryable', async () => {
  try {
    await storagePut(
      { params: { bucketId: 'b1', objectKey: 'k', body: 'AAAA' }, tenant, credential: {} },
      { http: async () => { throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.nonRetryable, false);
  }
});

test('storage.get: 200 returns base64 body + contentType', async () => {
  const out = await storageGet(
    { params: { bucketId: 'b1', objectKey: 'k' }, tenant, credential: {} },
    { http: async () => ({ status: 200, headers: new Map([['content-type', 'text/plain']]), arrayBuffer: async () => Buffer.from('hello') }) },
  );
  assert.equal(out.status, 'success');
  assert.equal(Buffer.from(out.body, 'base64').toString('utf8'), 'hello');
  assert.equal(out.contentType, 'text/plain');
});

test('storage.get: 404 → non-retryable OBJECT_NOT_FOUND', async () => {
  try {
    await storageGet(
      { params: { bucketId: 'b1', objectKey: 'missing' }, tenant, credential: {} },
      { http: async () => ({ status: 404 }) },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'OBJECT_NOT_FOUND');
    assert.equal(err.nonRetryable, true);
  }
});

// -- functions.invoke --------------------------------------------------------------------

test('functions.invoke: success envelope', async () => {
  let seenWs;
  const out = await functionsInvoke(
    { params: { actionId: 'fn-abc', params: { k: 'v' } }, tenant, credential: {} },
    { executeFunctions: async (p) => { seenWs = p.workspaceId; return { status: 'success', activationId: 'a1', result: { ok: true } }; } },
  );
  assert.equal(out.status, 'success');
  assert.equal(out.activationId, 'a1');
  assert.deepEqual(out.result, { ok: true });
  assert.equal(seenWs, 'w-A');
});

test('functions.invoke: executor timeout → retryable FUNCTION_TIMEOUT', async () => {
  try {
    await functionsInvoke(
      { params: { actionId: 'fn-slow' }, tenant, credential: {} },
      { executeFunctions: async () => ({ status: 'timeout' }) },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'FUNCTION_TIMEOUT');
    assert.equal(err.nonRetryable, false);
  }
});

test('functions.invoke: 404 not found → non-retryable FUNCTION_NOT_FOUND', async () => {
  try {
    await functionsInvoke(
      { params: { actionId: 'nope' }, tenant, credential: {} },
      { executeFunctions: async () => { throw clientError('Function not found', 404, 'FUNCTION_NOT_FOUND'); } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'FUNCTION_NOT_FOUND');
    assert.equal(err.nonRetryable, true);
  }
});

// -- events.publish ----------------------------------------------------------------------

test('events.publish: success returns published count', async () => {
  let seenTopic;
  const out = await eventsPublish(
    { params: { topic: 'orders', messages: [{ value: '{}' }] }, tenant, credential: {} },
    { executeEvents: async (p) => { seenTopic = p.topic; return { topic: 'orders', published: 1 }; } },
  );
  assert.equal(out.status, 'success');
  assert.equal(out.published, 1);
  assert.equal(seenTopic, 'orders');
});

test('events.publish: empty messages → non-retryable EMPTY_PUBLISH, no kafka call', async () => {
  let called = false;
  try {
    await eventsPublish(
      { params: { topic: 'orders', messages: [] }, tenant, credential: {} },
      { executeEvents: async () => { called = true; return {}; } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'EMPTY_PUBLISH');
    assert.equal(err.nonRetryable, true);
    assert.equal(called, false);
  }
});

test('events.publish: broker error → retryable BROKER_UNAVAILABLE', async () => {
  try {
    await eventsPublish(
      { params: { topic: 'orders', messages: [{ value: '{}' }] }, tenant, credential: {} },
      { executeEvents: async () => { throw clientError('Kafka operation failed', 502, 'KAFKA_ERROR'); } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'BROKER_UNAVAILABLE');
    assert.equal(err.nonRetryable, false);
  }
});

// -- http.request ------------------------------------------------------------------------

test('http.request: public URL 200 → success, no credential forwarded', async () => {
  let seenHeaders;
  const out = await httpRequest(
    { params: { url: 'https://example.com/x', method: 'GET', headers: { authorization: 'Bearer leak', 'x-custom': '1' } }, tenant },
    {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      http: async (_url, opts) => { seenHeaders = opts.headers; return { status: 200, headers: new Map(), text: async () => 'ok' }; },
    },
  );
  assert.equal(out.status, 'success');
  assert.equal(out.httpStatus, 200);
  assert.equal(out.body, 'ok');
  assert.equal(seenHeaders.authorization, undefined, 'authorization must be stripped');
  assert.equal(seenHeaders['x-custom'], '1');
});

test('http.request: SSRF link-local → non-retryable SSRF_BLOCKED, no http call', async () => {
  let httpCalled = false;
  try {
    await httpRequest(
      { params: { url: 'https://169.254.169.254/latest/meta-data/' }, tenant },
      { http: async () => { httpCalled = true; return { status: 200 }; } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'SSRF_BLOCKED');
    assert.equal(err.nonRetryable, true);
    assert.equal(httpCalled, false);
  }
});

test('http.request: timeout (abort) → retryable REQUEST_TIMEOUT', async () => {
  try {
    await httpRequest(
      { params: { url: 'https://example.com/slow', timeoutMs: 5 }, tenant },
      {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        http: async (_url, opts) => new Promise((_res, rej) => { opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }),
      },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'REQUEST_TIMEOUT');
    assert.equal(err.nonRetryable, false);
  }
});

test('http.request: response over cap → non-retryable RESPONSE_TOO_LARGE', async () => {
  try {
    await httpRequest(
      { params: { url: 'https://example.com/big', maxResponseBytes: 10 }, tenant },
      {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        http: async () => ({ status: 200, headers: new Map([['content-length', '1000000']]), body: { cancel: async () => {} } }),
      },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'RESPONSE_TOO_LARGE');
    assert.equal(err.nonRetryable, true);
  }
});

// -- email.send --------------------------------------------------------------------------

test('email.send: always non-retryable CAPABILITY_UNAVAILABLE', async () => {
  try {
    await emailSend({ params: { to: ['a@example.com'], subject: 's' }, tenant });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'CAPABILITY_UNAVAILABLE');
    assert.equal(err.nonRetryable, true);
    assert.match(err.message, /no platform SMTP configuration/);
  }
});
