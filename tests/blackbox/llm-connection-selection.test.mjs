// Named LLM selection (#1171): real HTTP routing and executor; only external I/O is replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createLlmExecutor, createLlmProviderStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

const workspaceId = 'ws_selection';
const tenantId = 'tenant_a';
const base = `/v1/workspaces/${workspaceId}`;
const provider = { providerType: 'openai', endpoint: 'https://default.example/chat', allowedModels: ['shared-model', 'default-only'], defaultModel: 'shared-model', secretRef: { name: 'BYOK_DEFAULT' } };
const named = { ...provider, connectionId: 'anthropic-main', endpoint: 'https://named.example/chat', allowedModels: ['shared-model'], secretRef: { name: 'BYOK_NAMED' } };

async function harness({ configure = true, providerStore = createLlmProviderStore() } = {}) {
  const fetches = [];
  const secrets = [];
  const executor = createLlmExecutor({
    providerStore,
    endpointResolver: async () => ['93.184.216.34'],
    secretResolver: ref => { secrets.push(ref); return 'synthetic-selection-key'; },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      fetches.push({ url, body });
      if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"model":"shared-model","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
      return Response.json({ model: body.model, choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
    },
  });
  const server = createControlPlaneServer({ registry: {}, llmExecutor: executor, logger: { error() {} } });
  // In-memory streams exercise routing, auth and SSE without opening a listening socket.
  async function request(path, payload, { method = 'POST', tenant = tenantId, workspace = workspaceId } = {}) {
    const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, { method, url: path, headers: { 'content-type': 'application/json', 'x-tenant-id': tenant, 'x-workspace-id': workspace, 'x-auth-subject': 'admin', 'x-actor-roles': 'tenant_admin' } });
    const chunks = [];
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.setHeader = () => {};
    res.writeHead = (status, headers) => { res.statusCode = status; res.headers = new Headers(headers); res.headersSent = true; };
    const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
    server.emit('request', req, res);
    await finished;
    const text = Buffer.concat(chunks).toString();
    return { status: res.statusCode, text, json: () => JSON.parse(text) };
  }
  if (configure) {
    assert.equal((await request(`${base}/llm-provider`, provider, { method: 'PUT' })).status, 200);
    assert.equal((await request(`${base}/llm-providers`, named)).status, 201);
  }
  return { request, fetches, secrets, providerStore };
}

test('named completion selects its endpoint and secret instead of the default', async () => {
  const api = await harness();
  const response = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', model: 'shared-model', prompt: 'hi' });
  assert.equal(response.status, 200);
  assert.equal(response.json().content, 'hello');
  assert.equal(api.fetches[0].url, named.endpoint);
  assert.deepEqual(api.secrets, [named.secretRef]);
  assert.equal(Object.hasOwn(response.json(), 'connectionId'), false);
});

test('omitted connection keeps the default endpoint and missing-provider error', async () => {
  const api = await harness();
  for (const stream of [false, true]) {
    assert.equal((await api.request(`${base}/llm/completions`, { model: 'shared-model', prompt: 'hi', stream })).status, 200);
  }
  assert.deepEqual(api.fetches.map(call => call.url), [provider.endpoint, provider.endpoint]);
  assert.deepEqual(api.secrets, [provider.secretRef, provider.secretRef]);
  const empty = await harness({ configure: false });
  for (const stream of [false, true]) {
    const result = await empty.request(`${base}/llm/completions`, { model: 'shared-model', stream });
    assert.equal(result.status, 422);
    assert.equal(result.json().code, 'LLM_PROVIDER_MISSING');
  }
  assert.deepEqual(empty.fetches, []);
  assert.deepEqual(empty.secrets, []);
});

test('named streaming selects its endpoint and secret', async () => {
  const api = await harness();
  const response = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', model: 'shared-model', prompt: 'hi', stream: true });
  assert.equal(response.status, 200);
  const frames = response.text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
  assert.deepEqual(frames.map(frame => frame.type), ['delta', 'usage']);
  assert.equal(frames[0].content, 'hello');
  assert.equal(api.fetches[0].url, named.endpoint);
  assert.equal(api.fetches[0].body.stream, true);
  assert.deepEqual(api.secrets, [named.secretRef]);
  assert.ok(frames.every(frame => !Object.hasOwn(frame, 'connectionId')));
});

test('selected allow-list rejects a model permitted by the default before secret or provider I/O', async () => {
  const api = await harness();
  for (const stream of [false, true]) {
    const result = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', model: 'default-only', prompt: 'hi', stream });
    assert.equal(result.status, 422);
    assert.equal(result.json().code, 'MODEL_NOT_ALLOWED');
  }
  assert.deepEqual(api.fetches, []);
  assert.deepEqual(api.secrets, []);
});

test('missing, invalid and foreign connections fail closed before secret or provider I/O', async () => {
  const api = await harness();
  for (const stream of [false, true]) {
    for (const [connectionId, status, code] of [
      ['unknown', 422, 'LLM_CONNECTION_NOT_FOUND'],
      ...[null, false, 1, {}, [], '', 'Bad', '-bad', 'bad_id', 'a'.repeat(64)].map(id => [id, 400, 'INVALID_CONNECTION_ID']),
    ]) {
      const result = await api.request(`${base}/llm/completions`, { connectionId, model: 'shared-model', stream });
      assert.equal(result.status, status, JSON.stringify(connectionId));
      assert.equal(result.json().code, code);
    }
    const foreignTenant = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', model: 'shared-model', stream }, { tenant: 'tenant_b' });
    assert.equal(foreignTenant.status, 422);
    assert.equal(foreignTenant.json().code, 'LLM_CONNECTION_NOT_FOUND');
    const foreignWorkspace = await api.request('/v1/workspaces/ws_other/llm/completions', { connectionId: 'anthropic-main', model: 'shared-model', stream }, { workspace: 'ws_other' });
    assert.equal(foreignWorkspace.status, 422);
    assert.equal(foreignWorkspace.json().code, 'LLM_CONNECTION_NOT_FOUND');
  }
  assert.deepEqual(api.fetches, []);
  assert.deepEqual(api.secrets, []);
  // The admin route keeps its original 404 contract.
  assert.equal((await api.request(`${base}/llm-providers/unknown`, undefined, { method: 'GET' })).status, 404);
});

test('missing Postgres registry maps to 422 only for selection; invalid ids never query it', async () => {
  const queries = [];
  const providerStore = createLlmProviderStore({ pool: { async query(sql, params) {
    queries.push({ sql, params });
    throw Object.assign(new Error('registry absent'), { code: '42P01' });
  } } });
  const api = await harness({ providerStore, configure: false });
  for (const stream of [false, true]) {
    for (const connectionId of [null, 'Bad', '-bad', 'a'.repeat(64)]) {
      const invalid = await api.request(`${base}/llm/completions`, { connectionId, model: 'shared-model', stream });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.json().code, 'INVALID_CONNECTION_ID');
    }
  }
  assert.deepEqual(queries, []);
  for (const stream of [false, true]) {
    const missing = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', model: 'shared-model', stream });
    assert.equal(missing.status, 422);
    assert.equal(missing.json().code, 'LLM_CONNECTION_NOT_FOUND');
  }
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /WHERE tenant_id=\$1 AND workspace_id=\$2 AND connection_id=\$3/);
    assert.deepEqual(query.params, [tenantId, workspaceId, 'anthropic-main']);
  }
  await assert.rejects(() => providerStore.getConnection(workspaceId, 'anthropic-main', tenantId), { code: '42P01' });
  assert.deepEqual(api.fetches, []);
  assert.deepEqual(api.secrets, []);
});

test('named selection uses its default model and model admission metadata', async () => {
  const api = await harness();
  assert.equal((await api.request(`${base}/llm-providers/anthropic-main`, { ...named, allowedModels: ['named-model'], defaultModel: 'named-model' }, { method: 'PUT' })).status, 200);
  const completion = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', prompt: 'hi' });
  assert.equal(completion.status, 200);
  assert.equal(api.fetches[0].body.model, 'named-model');
  assert.equal(completion.json().model, 'named-model');
  api.fetches.length = 0;
  api.secrets.length = 0;
  for (const [metadata, options, code] of [
    [{ lifecycle: { state: 'retired' } }, {}, 'MODEL_RETIRED'],
    [{ capabilities: { streaming: false } }, { stream: true }, 'MODEL_CAPABILITY_UNAVAILABLE'],
    [{ capabilities: { maxOutputTokens: 64 } }, { maxTokens: 65 }, 'MODEL_CAPABILITY_UNAVAILABLE'],
  ]) {
    await api.providerStore.replaceModels(workspaceId, 'anthropic-main', { tenantId, models: [{ modelId: 'named-model', ...metadata }], selectable: ['named-model'] });
    const result = await api.request(`${base}/llm/completions`, { connectionId: 'anthropic-main', prompt: 'hi', ...options });
    assert.equal(result.status, 422);
    assert.equal(result.json().code, code);
  }
  assert.deepEqual(api.fetches, []);
  assert.deepEqual(api.secrets, []);
});
