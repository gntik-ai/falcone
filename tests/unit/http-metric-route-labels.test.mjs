// Issue #982: observe HTTP responses and /metrics through the real request listener.
// The established harness substitutes only DB/JWKS I/O and omits process bootstrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMetricsServer, TENANT } from './helpers/control-plane-metrics-server.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { Readable, Writable } from 'node:stream';
import http from 'node:http';

const httpSamples = (text) => text.split('\n').filter((line) => line.startsWith('falcone_http_'));
const routeLabels = (text) => new Set([...text.matchAll(/route="([^"]+)"/g)].map((match) => match[1]));

test('control-plane: pre-auth rejections use the matched static template and disclose no resource names', async () => {
  const server = await startMetricsServer();
  const scenarios = [
    ['/v1/tenants/f0-inject-tenant/quota/effective-limits', '/v1/tenants/{tenantId}/quota/effective-limits'],
    ['/v1/storage/buckets/f0-inject-bucket/objects/f0-inject-object', '/v1/storage/buckets/{bucketId}/objects/{objectKey}'],
    ['/v1/functions/workspaces/f0-inject-ws/secrets/f0-inject-secret', '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'],
    ['/v1/functions/actions/f0-inject-action/activations/f0-inject-activation/logs', '/v1/functions/actions/{actionId}/activations/{activationId}/logs'],
  ];
  for (const [path, template] of scenarios) {
    const response = await server.request(path, { bearer: null });
    assert.equal(response.status, 401, path);
    const scrape = await server.request('/metrics', { bearer: null });
    assert.equal(scrape.status, 200);
    assert.ok(scrape.body.includes(`method="GET",route="${template}",status="401"`), `missing ${template}`);
    assert.ok(!scrape.body.includes('f0-inject-'), 'request content leaked into metrics');
  }
});

test('control-plane: distinct unmatched requests add at most 15 samples, with or without Authorization', async () => {
  const server = await startMetricsServer();
  const before = httpSamples((await server.request('/metrics', { bearer: null })).body).length;
  for (const bearer of [null, server.token()]) {
    for (let i = 0; i < 10; i++) {
      assert.equal((await server.request(`/v1/f0-inject-${i}/xyz`, { bearer })).status, 404);
    }
  }
  const scrape = (await server.request('/metrics', { bearer: null })).body;
  assert.ok(httpSamples(scrape).length - before <= 15);
  assert.ok(!scrape.includes('f0-inject-'));
  assert.ok(routeLabels(scrape).has('unmatched'));
});

async function request(server, path, { method = 'GET', headers = {} } = {}) {
  const req = Readable.from([]);
  Object.assign(req, { method, url: path, headers });
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } });
  res.setHeader = () => {};
  res.writeHead = (status) => { res.statusCode = status; };
  const finished = new Promise((resolve) => res.on('finish', resolve));
  server.emit('request', req, res);
  await finished;
  return { status: res.statusCode, body: Buffer.concat(chunks).toString() };
}

test('executor: matched data-plane and optional routes have static template labels before auth', async () => {
  const server = createControlPlaneServer({
    registry: {}, flowExecutor: {}, flowMonitoringExecutor: {}, mcpEngine: {}, logger: { error() {} },
  });
  const scenarios = [
    ['GET', '/v1/postgres/workspaces/f0-inject-ws/data/f0-inject-db/schemas/f0-inject-s/tables/f0-inject-t/rows', '/v1/postgres/workspaces/{workspaceId}/data/{db}/schemas/{schema}/tables/{table}/rows'],
    ['POST', '/v1/events/workspaces/f0-inject-ws/topics/f0-inject-topic/publish', '/v1/events/workspaces/{workspaceId}/topics/{topic}/publish'],
    ['POST', '/v1/functions/workspaces/f0-inject-ws/actions/f0-inject-action/invocations', '/v1/functions/workspaces/{workspaceId}/actions/{actionId}/invocations'],
    ['GET', '/v1/flows/workspaces/f0-inject-ws/flows/f0-inject-flow/schedule', '/v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule'],
    ['GET', '/v1/flows/workspaces/f0-inject-ws/executions/f0-inject-exec/events', '/v1/flows/workspaces/{workspaceId}/executions/{executionId}/events'],
    ['POST', '/v1/mcp/workspaces/f0-inject-ws/servers/f0-inject-server/versions/f0-inject-ver/approval', '/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions/{version}/approval'],
  ];
  for (const [method, path, template] of scenarios) {
    assert.equal((await request(server, path, { method })).status, 401, path);
    const scrape = await request(server, '/metrics');
    assert.ok(scrape.body.includes(`method="${method}",route="${template}",status="401"`), `missing ${template}`);
    assert.ok(!scrape.body.includes('f0-inject-'), 'request content leaked into metrics');
  }
});

test('executor: distinct unmatched paths add at most 15 samples, including requests with Authorization', async () => {
  const server = createControlPlaneServer({ registry: {}, logger: { error() {} } });
  const before = httpSamples((await request(server, '/metrics')).body).length;
  for (const headers of [{}, { authorization: 'Bearer f0-inject-token' }]) {
    for (let i = 0; i < 10; i++) {
      assert.equal((await request(server, `/v1/f0-inject-${i}/xyz`, { headers })).status, 404);
    }
  }
  const scrape = (await request(server, '/metrics')).body;
  assert.ok(httpSamples(scrape).length - before <= 15);
  assert.ok(!scrape.includes('f0-inject-'));
  assert.ok(scrape.includes('route="unmatched",status="404"'));
});

test('executor: upstream fall-through uses proxied and cannot mint paths or activation labels', async (t) => {
  // Substitute only the upstream HTTP transport. The real proxy streams the response
  // and the real server finish hook records it; no listening sockets are needed.
  t.mock.method(http, 'request', (_options, onResponse) => {
    const outgoing = new Writable({ write(_chunk, _encoding, done) { done(); } });
    outgoing.setTimeout = () => outgoing;
    queueMicrotask(() => {
      const incoming = Readable.from([Buffer.from('{"upstream":true}')]);
      Object.assign(incoming, { statusCode: 200, headers: { 'content-type': 'application/json' } });
      onResponse(incoming);
    });
    return outgoing;
  });
  const server = createControlPlaneServer({ registry: {}, controlPlaneUpstream: 'http://fixture', logger: { error() {} } });
  const before = httpSamples((await request(server, '/metrics')).body).length;
  for (let i = 0; i < 10; i++) {
    const response = await request(server, `/v1/functions/actions/f0-inject-${i}/activations/f0-inject-act/logs`);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { upstream: true });
  }
  const scrape = (await request(server, '/metrics')).body;
  assert.ok(httpSamples(scrape).length - before <= 15);
  assert.ok(scrape.includes('route="proxied",status="200"} 10'));
  assert.ok(!scrape.includes('f0-inject-'));
});

test('both servers: health and root have fixed labels and custom methods become OTHER', async () => {
  const control = await startMetricsServer();
  const executor = createControlPlaneServer({ registry: {}, logger: { error() {} } });
  for (const invoke of [control.request, (path, options) => request(executor, path, options)]) {
    assert.equal((await invoke('/healthz')).status, 200);
    assert.equal((await invoke('/readyz')).status, 200);
    await invoke('/');
    await invoke('/f0-inject-method', { method: 'FOO' });
    const scrape = (await invoke('/metrics')).body;
    assert.ok(scrape.includes('method="GET",route="health",status="200"} 2'));
    assert.ok(scrape.includes('method="GET",route="root"'));
    assert.ok(scrape.includes('method="OTHER",route="unmatched",status="404"} 1'));
    assert.ok(!scrape.includes('FOO') && !scrape.includes('f0-inject-'));
  }
});

test('control-plane: authenticated success and forbidden responses retain template counts and histograms', async () => {
  const server = await startMetricsServer();
  for (let i = 0; i < 2; i++) {
    assert.equal((await server.request(`/v1/tenants/${TENANT}?marker=f0-inject-query`, { bearer: server.token() })).status, 200);
  }
  assert.equal((await server.request('/v1/tenants/f0-inject-foreign', { bearer: server.token() })).status, 403);
  const scrape = (await server.request('/metrics')).body;
  assert.ok(scrape.includes('falcone_http_requests_total{method="GET",route="/v1/tenants/{tenantId}",status="200"} 2'));
  assert.ok(scrape.includes('falcone_http_requests_total{method="GET",route="/v1/tenants/{tenantId}",status="403"} 1'));
  assert.ok(scrape.includes('falcone_http_request_duration_seconds_bucket{method="GET",route="/v1/tenants/{tenantId}",le="+Inf"} 3'));
  assert.ok(scrape.includes('falcone_http_request_duration_seconds_count{method="GET",route="/v1/tenants/{tenantId}"} 3'));
  assert.ok(!scrape.includes('f0-inject-') && !scrape.includes(TENANT));
});

test('executor: verified authenticated requests retain template counts and histograms', async () => {
  const credentials = await startMetricsServer();
  const server = createControlPlaneServer({
    registry: {}, jwtVerifier: credentials.executorJwtVerifier,
    // Database boundary for the API-key list. Authentication and dispatch are real.
    apiKeyStore: { async listKeys() { return [{ id: 'fixture-key', key_type: 'anon' }]; } },
    logger: { error() {} },
  });
  const headers = { authorization: `Bearer ${credentials.token({ workspace_id: 'f0-inject-auth-ws' })}` };
  for (let i = 0; i < 2; i++) {
    const response = await request(server, '/v1/workspaces/f0-inject-auth-ws/api-keys', { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { items: [{ id: 'fixture-key', key_type: 'anon' }] });
  }
  assert.equal((await request(server, '/v1/workspaces/f0-inject-foreign/api-keys', { headers })).status, 403);
  const scrape = (await request(server, '/metrics')).body;
  assert.ok(scrape.includes('falcone_http_requests_total{method="GET",route="/v1/workspaces/{workspaceId}/api-keys",status="200"} 2'));
  assert.ok(scrape.includes('falcone_http_requests_total{method="GET",route="/v1/workspaces/{workspaceId}/api-keys",status="403"} 1'));
  assert.ok(scrape.includes('falcone_http_request_duration_seconds_bucket{method="GET",route="/v1/workspaces/{workspaceId}/api-keys",le="+Inf"} 3'));
  assert.ok(scrape.includes('falcone_http_request_duration_seconds_count{method="GET",route="/v1/workspaces/{workspaceId}/api-keys"} 3'));
  assert.ok(!scrape.includes('f0-inject-') && !scrape.includes(TENANT));
});
