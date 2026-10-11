// fix-1118: capture every application logger call at the public HTTP/SSE boundary.
// Only the network transport and external database/Temporal I/O are substituted.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Duplex, Writable } from 'node:stream';
import { inspect } from 'node:util';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { createLlmExecutor, createLlmProviderStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { startMetricsServer, TENANT } from '../unit/helpers/control-plane-metrics-server.mjs';

const SENTINEL = 'flc_anon_synthetic_1118_log_capture';
const WS = 'ws_log_capture';
const FLOW_PATH = `/v1/flows/workspaces/${WS}/executions/ten_log_capture:${WS}:flow:run/events`;
const FLOW_URL = `${FLOW_PATH}?apikey=${SENTINEL}`;

function captureLogger() {
  const calls = [];
  const logger = Object.fromEntries(['error', 'warn', 'info', 'debug', 'log', 'trace'].map(
    (level) => [level, (...args) => calls.push({ level, args })],
  ));
  return { logger, calls };
}

function assertNoKey(calls) {
  const text = inspect(calls, { depth: null, maxStringLength: null, maxArrayLength: null });
  // Assert a boolean so failure output never prints captured diagnostics.
  assert.equal(text.includes(SENTINEL) || text.includes('apikey='), false, 'application log contains API-key query material');
}

async function request(server, path = FLOW_URL, headers = {}, { method = 'GET', body = '', stopWhen } = {}) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
      if (stopWhen && Buffer.concat(chunks).toString().includes(stopWhen)) queueMicrotask(() => socket.destroy());
    },
  });
  const finished = new Promise((resolve, reject) => {
    socket.once('finish', resolve);
    if (stopWhen) socket.once('close', resolve);
    socket.once('error', reject);
  });
  server.emit('connection', socket);
  const lines = Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('');
  socket.push(`${method} ${path} HTTP/1.1\r\nHost: executor.test\r\n${lines}Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    return { status: Number(raw.split(' ')[1]), raw };
  } finally {
    socket.destroy();
  }
}

function databaseError() {
  return Object.assign(new Error(`database failed for http://executor.test${FLOW_URL}`), { code: 'ECONNRESET' });
}

test('executor: forced 5xx on flow query-key authentication leaves no key in any logger call', async () => {
  const { logger, calls } = captureLogger();
  const apiKeyStore = createApiKeyStore({ pool: { async query() { throw databaseError(); } } });
  // The route is registered, but the database fails before monitoring is invoked.
  const server = createControlPlaneServer({ registry: {}, apiKeyStore, flowMonitoringExecutor: {}, logger });
  const response = await request(server);
  assert.equal(response.status, 500);
  assert.match(response.raw, /CONTROL_PLANE_ERROR/);
  assertNoKey(calls);
  assert.equal(calls.length, 1, 'failure must actually reach the logger');
});

test('executor: proxied flow upstream failure forwards the query but never logs it', async (t) => {
  const { logger, calls } = captureLogger();
  t.mock.method(http, 'request', (options) => {
    assert.equal(options.path, FLOW_URL, 'proxy must preserve upstream authentication');
    const outgoing = new Writable({
      write(_chunk, _encoding, done) { done(); },
      final(done) {
        const error = Object.assign(new Error('upstream unavailable'), { code: 'ECONNRESET' });
        error.cause = new Error(`GET ${options.path}`);
        error.request = { url: options.path, key: SENTINEL };
        outgoing.destroy(error);
        done();
      },
    });
    outgoing.setTimeout = () => outgoing;
    return outgoing;
  });
  const server = createControlPlaneServer({ registry: {}, controlPlaneUpstream: 'http://upstream.test', logger });
  const response = await request(server);
  assert.equal(response.status, 502);
  assert.match(response.raw, /UPSTREAM_UNAVAILABLE/);
  assert.equal(calls.length, 1);
  assertNoKey(calls);
});

function validKeyStore(keyType = 'anon') {
  return createApiKeyStore({ pool: { async query() {
    return { rowCount: 1, rows: [{ id: 'synthetic-key', tenant_id: 'ten_log_capture', workspace_id: WS, key_type: keyType,
      scopes: keyType === 'service' ? ['data:read', 'data:write'] : ['data:read'] }] };
  } } });
}

test('executor: flow pre-stream 5xx logs the normalized pathname', async () => {
  const { logger, calls } = captureLogger();
  // Real dispatch of an incompletely wired monitoring service raises a TypeError.
  const server = createControlPlaneServer({ registry: {}, apiKeyStore: validKeyStore(), flowMonitoringExecutor: {}, logger });
  const response = await request(server);
  assert.equal(response.status, 500);
  assert.match(response.raw, /FLOW_MONITORING_ERROR/);
  assert.equal(calls.length, 1);
  assertNoKey(calls);
  assert.equal(inspect(calls, { depth: null }).includes(FLOW_PATH), true, 'error log must identify only the normalized pathname');
});

test('control-plane: database 5xx diagnostics cannot log request query material', async () => {
  const { logger, calls } = captureLogger();
  const server = await startMetricsServer({ logger, databasePool: { async query() { throw databaseError(); } } });
  const response = await server.request(`/v1/tenants/${TENANT}?apikey=${SENTINEL}`, { bearer: server.token() });
  assert.equal(response.status, 500);
  assert.equal(JSON.parse(response.body).code, 'CONTROL_PLANE_ERROR');
  assert.equal(calls.length, 1);
  assertNoKey(calls);
});

test('control-plane: token verification failure never logs query material', async () => {
  const { logger, calls } = captureLogger();
  const server = await startMetricsServer({ logger, jwksFetch: async () => { throw databaseError(); } });
  const response = await server.request(`/v1/tenants/${TENANT}?apikey=${SENTINEL}`, { bearer: server.token() });
  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body).code, 'INVALID_TOKEN');
  assert.equal(calls.length, 1);
  assertNoKey(calls);
});

test('executor: invalid query key returns 401 without logging it', async () => {
  const { logger, calls } = captureLogger();
  const apiKeyStore = createApiKeyStore({ pool: { async query() { return { rowCount: 0, rows: [] }; } } });
  const server = createControlPlaneServer({ registry: {}, apiKeyStore, flowMonitoringExecutor: {}, logger });
  const response = await request(server);
  assert.equal(response.status, 401);
  assert.match(response.raw, /UNAUTHENTICATED/);
  assertNoKey(calls);
});

async function monitoring(t, logger, fail = false) {
  let createFlowMonitoringExecutor;
  try {
    ({ createFlowMonitoringExecutor } = await import('../../apps/control-plane-executor/src/runtime/flow-monitoring-executor.mjs'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !/Cannot find package '(yaml|ajv)'/.test(error.message)) throw error;
    t.skip('Existing yaml/ajv dependency is not installed; CI must run real Temporal-boundary cases');
    return null;
  }
  return createFlowMonitoringExecutor({ logger, workflowHistoryProvider: {
    async describe() {
      if (fail) throw databaseError();
      return { status: { name: 'Completed' } };
    },
    async fetchHistory() { return { events: [{ eventId: 1, activityTaskScheduledEventAttributes: { activityId: 'task' } }] }; },
    isTerminal() { return true; },
  } });
}

test('executor: successful flow SSE query-key stream contains no application log leak', async (t) => {
  const { logger, calls } = captureLogger();
  const flowMonitoringExecutor = await monitoring(t, logger);
  if (!flowMonitoringExecutor) return;
  const server = createControlPlaneServer({ registry: {}, apiKeyStore: validKeyStore(), flowMonitoringExecutor, logger });
  const response = await request(server);
  assert.equal(response.status, 200);
  assert.match(response.raw, /text\/event-stream/);
  assert.match(response.raw, /event: node-status/);
  assert.match(response.raw, /event: stream-end/);
  assertNoKey(calls);
});

test('executor: foreign execution query-key stream returns 403 without a log leak', async (t) => {
  const { logger, calls } = captureLogger();
  const flowMonitoringExecutor = await monitoring(t, logger);
  if (!flowMonitoringExecutor) return;
  const server = createControlPlaneServer({ registry: {}, apiKeyStore: validKeyStore(), flowMonitoringExecutor, logger });
  const response = await request(server, FLOW_URL.replace('ten_log_capture:', 'ten_foreign:'));
  assert.equal(response.status, 403);
  assert.match(response.raw, /FORBIDDEN/);
  assert.doesNotMatch(response.raw, /text\/event-stream/);
  assertNoKey(calls);
});

test('executor: Temporal upstream failure on an open flow stream has no application log leak', async (t) => {
  const { logger, calls } = captureLogger();
  const flowMonitoringExecutor = await monitoring(t, logger, true);
  if (!flowMonitoringExecutor) return;
  const server = createControlPlaneServer({ registry: {}, apiKeyStore: validKeyStore(), flowMonitoringExecutor, logger });
  const response = await request(server, FLOW_URL, {}, { stopWhen: 'FLOW_MONITORING_STREAM_ERROR' });
  assert.equal(response.status, 200);
  assert.match(response.raw, /event: error/);
  assertNoKey(calls);
});

test('control-plane: unmatched flow events request does not log its query', async () => {
  const { logger, calls } = captureLogger();
  const server = await startMetricsServer({ logger });
  const response = await server.request(FLOW_URL);
  assert.equal(response.status, 404);
  assertNoKey(calls);
});

test('executor: the other query-authenticated streaming error path also logs no query', async () => {
  const { logger, calls } = captureLogger();
  const llmExecutor = createLlmExecutor({ providerStore: createLlmProviderStore({
    pool: { async query() { throw databaseError(); } },
  }) });
  const server = createControlPlaneServer({ registry: {}, apiKeyStore: validKeyStore('service'), llmExecutor, logger });
  const response = await request(server, `/v1/workspaces/${WS}/llm/completions?apikey=${SENTINEL}`,
    { 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ stream: true, prompt: 'test' }) });
  assert.equal(response.status, 500);
  assert.match(response.raw, /LLM_PROVIDER_ERROR/);
  assert.equal(calls.length, 1);
  assertNoKey(calls);
});
