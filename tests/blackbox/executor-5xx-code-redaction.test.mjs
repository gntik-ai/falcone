// fix-1013: drive the real executor HTTP envelopes with injected failing boundaries.
// No database, Temporal or LLM provider is contacted; original errors are captured in logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { clientError, mapPgError } from '../../apps/control-plane-executor/src/runtime/errors.mjs';

const WS = 'ws_code_redaction';
const headers = {
  'content-type': 'application/json',
  'x-tenant-id': 'ten_code_redaction',
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-code-redaction',
};
const rowsPath = `/v1/postgres/workspaces/${WS}/data/appdb/schemas/public/tables/notes/rows`;
const flowPath = `/v1/flows/workspaces/${WS}/executions/run-redaction/events`;
const llmPath = `/v1/workspaces/${WS}/llm/completions`;

function diagnosticError(code, statusCode) {
  return Object.assign(new Error('private driver message'), {
    code, ...(statusCode === undefined ? {} : { statusCode }),
    detail: 'private pg detail', hint: 'private pg hint', sql: 'private SQL',
    cause: new Error('private cause'), errors: [{ message: 'private validation detail' }],
    dimension: 'private dimension',
  });
}

async function withServer(options, fn) {
  const logged = [];
  const server = createControlPlaneServer({
    registry: {}, ...options, logger: { error(...args) { logged.push(args); } },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, logged);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function assertLogged(logged, error) {
  assert.equal(logged.length, 1, '5xx must log once');
  assert.equal(logged[0][0], '[control-plane] request failed:');
  assert.equal(logged[0][1], error, 'log the original error, including its code and cause');
}

for (const [code, statusCode] of [
  ['22023', undefined], ['ECONNREFUSED', undefined], ['ETIMEDOUT', undefined],
  ['ECONNRESET', undefined], ['57P01', 500], ['library_error', 500],
]) {
  test(`unclassified ${code} (${statusCode ?? 'no status'}) returns opaque 500 and logs the original`, async () => {
    const error = diagnosticError(code, statusCode);
    const registry = { async withWorkspaceClient() { throw error; } };
    await withServer({ registry }, async (baseUrl, logged) => {
      const response = await fetch(`${baseUrl}${rowsPath}`, { headers });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { code: 'CONTROL_PLANE_ERROR', message: 'Internal server error' });
      assertLogged(logged, error);
      assert.equal(logged[0][1].code, code);
    });
  });
}

for (const error of [
  clientError('Database unavailable', 503, 'DB_UNAVAILABLE'),
  mapPgError(diagnosticError('XX000')),
]) {
  test(`classified ${error.statusCode} ${error.code} keeps its code and logs the original`, async () => {
    // Even classified 5xx must leave diagnostics, errors[] and dimension out of the body.
    Object.assign(error, { errors: [{ message: 'private detail' }], dimension: 'private dimension' });
    await withServer({ registry: { async withWorkspaceClient() { throw error; } } }, async (baseUrl, logged) => {
      const response = await fetch(`${baseUrl}${rowsPath}`, { headers });
      assert.equal(response.status, error.statusCode);
      assert.deepEqual(await response.json(), { code: error.code, message: 'Internal server error' });
      assertLogged(logged, error);
    });
  });
}

for (const [error, expected] of [
  [mapPgError({ code: '23505' }), { code: 'UNIQUE_VIOLATION', message: 'Unique constraint violation' }],
  [Object.assign(clientError('Quota exceeded', 429, 'QUOTA_EXCEEDED'), { dimension: 'executions' }),
    { code: 'QUOTA_EXCEEDED', message: 'Quota exceeded', dimension: 'executions' }],
  [Object.assign(clientError('Flow validation failed', 422, 'FLOW_VALIDATION_FAILED'), { errors: [{ code: 'FLW_E_INVALID', nodeId: 'task' }] }),
    { code: 'FLOW_VALIDATION_FAILED', message: 'Flow validation failed', errors: [{ code: 'FLW_E_INVALID', nodeId: 'task' }] }],
]) {
  test(`4xx ${error.code} preserves the complete existing envelope`, async () => {
    await withServer({ flowExecutor: { async executeFlows() { throw error; } } }, async (baseUrl, logged) => {
      const response = await fetch(`${baseUrl}/v1/flows/workspaces/${WS}/flows`, { headers });
      assert.equal(response.status, error.statusCode);
      assert.deepEqual(await response.json(), expected);
      assert.deepEqual(logged, []);
    });
  });
}

const preStreamPaths = [
  {
    name: 'flow monitoring', path: flowPath, fallback: 'FLOW_MONITORING_ERROR',
    options: (error) => ({ flowMonitoringExecutor: { async subscribe() { throw error; } } }),
    request: { headers },
  },
  {
    name: 'LLM streaming', path: llmPath, fallback: 'LLM_PROVIDER_ERROR',
    options: (error) => ({ llmExecutor: { async *completeStream() { throw error; } } }),
    request: { method: 'POST', headers, body: JSON.stringify({ stream: true, prompt: 'test' }) },
  },
];

for (const route of preStreamPaths) {
  for (const code of ['22023', 'ECONNREFUSED', 'ETIMEDOUT']) {
    test(`${route.name} pre-stream ${code} gets its fallback and logs the original`, async () => {
      const error = diagnosticError(code);
      await withServer(route.options(error), async (baseUrl, logged) => {
        const response = await fetch(`${baseUrl}${route.path}`, route.request);
        assert.equal(response.status, 500);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.deepEqual(await response.json(), { code: route.fallback, message: 'Internal server error' });
        assertLogged(logged, error);
      });
    });
  }
  for (const error of [
    clientError('Database unavailable', 503, 'DB_UNAVAILABLE'),
    clientError('Provider unavailable', 502, 'LLM_PROVIDER_ERROR'),
    clientError('Foreign execution', 403, 'FORBIDDEN'),
  ]) {
    test(`${route.name} pre-stream preserves classified ${error.statusCode} ${error.code}`, async () => {
      await withServer(route.options(error), async (baseUrl, logged) => {
        const response = await fetch(`${baseUrl}${route.path}`, route.request);
        assert.equal(response.status, error.statusCode);
        assert.deepEqual(await response.json(), {
          code: error.code, message: error.statusCode >= 500 ? 'Internal server error' : error.message,
        });
        if (error.statusCode >= 500) assertLogged(logged, error);
        else assert.deepEqual(logged, []);
      });
    });
  }
}

for (const code of ['22023', 'ECONNREFUSED']) {
  test(`flow monitoring SSE error event redacts ${code} and logs the original`, async () => {
    const error = diagnosticError(code);
    const flowMonitoringExecutor = {
      async subscribe({ onEvent }) {
        onEvent({ id: '1', type: 'node-status', nodeId: 'task', status: 'running' });
        throw error;
      },
    };
    await withServer({ flowMonitoringExecutor }, async (baseUrl, logged) => {
      const response = await fetch(`${baseUrl}${flowPath}`, { headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const frames = (await response.text()).split('\n\n');
      const errorFrame = frames.find((frame) => frame.startsWith('event: error\n'));
      assert.ok(errorFrame, 'stream must end with an error frame');
      assert.deepEqual(JSON.parse(errorFrame.split('data: ')[1]), { code: 'FLOW_MONITORING_ERROR' });
      assertLogged(logged, error);
    });
  });
}
