import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

const auth = { mode: 'oauth2', grantType: 'client_credentials', tokenEndpoint: 'https://tokens.example.test/oauth', clientId: 'client', clientSecretRef: { name: 'BYOK_CLIENT' } };
const config = { tenantId: 'tenant-a', connectionId: 'oauth', providerType: 'openai', endpoint: 'https://provider.example.test/v1/chat/completions', allowedModels: ['model-a'], defaultModel: 'model-a', auth };
const input = { tenantId: 'tenant-a', prompt: 'hello' };
const opts = { endpointResolver: async () => ['93.184.216.34'], secretResolver: async () => 'client-sentinel' };
const success = () => Response.json({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }, model: 'model-a' });

test('OAuth connections persist only config and complete with bearer auth; PUT and DELETE evict tokens', async () => {
  let exchanges = 0;
  const sent = [];
  const executor = createLlmExecutor({ ...opts, fetchImpl: async (url, init) => {
    if (url === auth.tokenEndpoint) { exchanges++; return Response.json({ access_token: 'access-sentinel', expires_in: 3600 }); }
    sent.push(Object.fromEntries(new Headers(init.headers)));
    return success();
  } });
  const row = await executor.createConnection('workspace', config);
  assert.deepEqual(row.auth, auth);
  await executor.complete('workspace', input);
  await executor.complete('workspace', input);
  assert.equal(exchanges, 1);
  assert.equal(sent[0].authorization, 'Bearer access-sentinel');
  await executor.replaceConnection('workspace', 'oauth', config);
  await executor.complete('workspace', input);
  assert.equal(exchanges, 2);
  await executor.deleteConnection('workspace', 'oauth', 'tenant-a');
  await executor.createConnection('workspace', config);
  await executor.complete('workspace', input);
  assert.equal(exchanges, 3);
  const stored = await executor.listConnections('workspace', 'tenant-a');
  const ledger = await executor.getLedger('workspace', { tenantId: 'tenant-a' });
  assert.doesNotMatch(JSON.stringify({ row, stored, ledger }), /(?:access|client)-sentinel/);
});

test('config routes reject blocked token endpoints, secret refs and tenant profiles without writing rows', async () => {
  const { withLlmServer, collection, singular } = await import('./helpers/llm-connections.mjs');
  await withLlmServer(async request => {
    for (const [method, path, body] of [
      ['POST', collection, { ...config, auth: { ...auth, tokenEndpoint: 'http://169.254.169.254/token' } }],
      ['PUT', singular, { ...config, auth: { ...auth, clientSecretRef: { name: 'DATABASE_PASSWORD' } } }],
      ['POST', collection, { ...config, auth: { mode: 'workloadIdentity', profile: 'cloud' } }],
      ['POST', collection, { ...config, auth: { ...auth, access_token: 'access-sentinel' } }],
    ]) {
      const response = await request(method, path, body);
      assert.equal(response.status, 400);
      assert.doesNotMatch(JSON.stringify(response.body), /sentinel/);
      assert.deepEqual((await request('GET', collection)).body.items, []);
    }
    const created = await request('POST', collection, config);
    assert.equal(created.status, 201);
    const denied = await request('PUT', `${collection}/oauth`, { ...config, auth: { mode: 'workloadIdentity', profile: 'cloud' } });
    assert.equal(denied.status, 400);
    assert.equal(denied.body.code, 'LLM_IDENTITY_PROFILE_NOT_ALLOWED');
    assert.deepEqual((await request('GET', `${collection}/oauth`)).body, created.body);
    const legacy = await request('PUT', singular, config);
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body.auth, auth);
  }, { identityProfiles: { cloud: { tokenEndpoint: auth.tokenEndpoint, audience: 'cloud', tenantAllowList: ['other-tenant'] } } });
});

test('revoked grants and freshly rejected tokens fail streams before SSE headers with fixed errors', async () => {
  const { withLlmServer, singular } = await import('./helpers/llm-connections.mjs');
  for (const revoked of [true, false]) {
    await withLlmServer(async request => {
      assert.equal((await request('PUT', singular, config)).status, 200);
      const response = await request('POST', '/v1/workspaces/shared/llm/completions', { prompt: 'hello', stream: true });
      assert.equal(response.status, 424, JSON.stringify(response));
      assert.equal(response.body.code, 'LLM_PROVIDER_AUTH_FAILED');
      assert.doesNotMatch(response.headers['content-type'], /event-stream/);
      assert.doesNotMatch(JSON.stringify(response), /sentinel/);
    }, { backendFactory: undefined, fetchImpl: async url => url === auth.tokenEndpoint
      ? revoked ? Response.json({ error: 'invalid_grant', error_description: 'refresh-sentinel' }, { status: 400 })
        : Response.json({ access_token: 'access-sentinel', expires_in: 3600 })
      : new Response('access-sentinel', { status: 401 }) });
  }
});

test('stored identity profile is rechecked against the verified tenant before any exchange', async () => {
  let calls = 0;
  const executor = createLlmExecutor({ ...opts, identityProfiles: {}, fetchImpl: async () => { calls++; return success(); } });
  await executor.providerStore.createConnection('workspace', { ...config, auth: { mode: 'workloadIdentity', profile: 'unknown' } });
  await assert.rejects(executor.complete('workspace', input), { statusCode: 422, code: 'LLM_IDENTITY_PROFILE_NOT_ALLOWED' });
  assert.equal(calls, 0);
});

test('brokered batches use bearer for submission and polling without persisting credentials', async () => {
  let now = 0;
  let exchanges = 0;
  const sent = [];
  const executor = createLlmExecutor({ ...opts, now: () => now, fetchImpl: async (url, init) => {
    if (url === auth.tokenEndpoint) { exchanges++; return Response.json({ access_token: 'access-sentinel', expires_in: 120 }); }
    sent.push(Object.fromEntries(new Headers(init.headers)));
    return Response.json({ type: 'message_batch', id: 'remote-batch', processing_status: 'in_progress', request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 } });
  } });
  await executor.createConnection('workspace', { ...config, providerType: 'anthropic', endpoint: 'https://provider.example.test/v1/messages' });
  const result = await executor.submitBatch('workspace', { items: [{ customId: 'one', prompt: 'hello' }] }, { tenantId: 'tenant-a' });
  assert.equal(result.status, 202);
  assert.equal(sent[0].authorization, 'Bearer access-sentinel');
  assert.equal(sent[0]['x-api-key'], undefined);
  now = 61_000;
  await executor.batchReconciler.runOnce();
  assert.equal(sent.length, 2);
  assert.equal(exchanges, 2);
  assert.doesNotMatch(JSON.stringify({ result, row: await executor.batchStore.get('workspace', result.body.batchId, 'tenant-a') }), /(?:access|client)-sentinel/);
});

test('another replica never reuses a token under an older connection version', async () => {
  let exchanges = 0;
  const options = { ...opts, fetchImpl: async url => url === auth.tokenEndpoint
    ? Response.json({ access_token: `access-${++exchanges}`, expires_in: 3600 }) : success() };
  const first = createLlmExecutor(options);
  const second = createLlmExecutor({ ...options, providerStore: first.providerStore });
  await first.createConnection('workspace', config);
  await second.complete('workspace', input);
  await first.replaceConnection('workspace', 'oauth', config);
  await second.complete('workspace', input);
  assert.equal(exchanges, 2);
});

test('Anthropic and Gemini brokered requests use bearer instead of native key headers', async () => {
  for (const providerType of ['anthropic', 'gemini']) {
    const sent = [];
    const executor = createLlmExecutor({ ...opts, fetchImpl: async (url, init) => {
      if (url === auth.tokenEndpoint) return Response.json({ access_token: 'access-sentinel', expires_in: 120 });
      sent.push(Object.fromEntries(new Headers(init.headers)));
      return providerType === 'anthropic'
        ? Response.json({ type: 'message', content: [{ type: 'text', text: 'hello' }], model: 'model-a', stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 1 } })
        : Response.json({ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 } });
    } });
    await executor.createConnection('workspace', { ...config, providerType });
    assert.equal((await executor.complete('workspace', input)).content, 'hello');
    assert.equal(sent[0].authorization, 'Bearer access-sentinel');
    assert.equal(sent[0]['x-api-key'], undefined);
    assert.equal(sent[0]['x-goog-api-key'], undefined);
  }
});

test('projected-token failures emit only fixed errors in HTTP responses and captured logs', async () => {
  const { createControlPlaneServer } = await import('../../apps/control-plane-executor/src/runtime/server.mjs');
  const { createConnectionRegistry } = await import('../../apps/control-plane-executor/src/runtime/connection-registry.mjs');
  const { request: httpRequest } = await import('../helpers/http-request.mjs');
  const { headers } = await import('./helpers/llm-connections.mjs');
  const logs = [];
  let exchanges = 0;
  const executor = createLlmExecutor({ ...opts,
    identityProfiles: { cloud: { tokenEndpoint: auth.tokenEndpoint, audience: 'cloud', tenantAllowList: ['tenant-a'] } },
    readTokenFile: async () => { throw new Error('sa-sentinel refresh-sentinel client-sentinel access-sentinel'); },
    fetchImpl: async () => { exchanges++; return success(); } });
  await executor.setProvider('shared', { ...config, auth: { mode: 'workloadIdentity', profile: 'cloud' } });
  const registry = createConnectionRegistry({ resolveConnection: async () => { throw new Error('unexpected DB access'); } });
  const server = createControlPlaneServer({ registry, llmExecutor: executor, logger: { error: (...args) => logs.push(args) } });
  try {
    const response = await httpRequest(server, { path: '/v1/workspaces/shared/llm/completions', headers, body: JSON.stringify({ prompt: 'hello', stream: true }) });
    assert.equal(response.status, 500);
    assert.equal(response.body.code, 'LLM_PROVIDER_SECRET_UNRESOLVED');
    assert.equal(exchanges, 0);
    assert.ok(logs.length > 0);
    assert.doesNotMatch(JSON.stringify({ response, logs, rows: await executor.listConnections('shared', 'tenant-a'), ledger: await executor.getLedger('shared', { tenantId: 'tenant-a' }) }), /(?:sa|refresh|client|access)-sentinel/);
  } finally { server.close(); await registry.end(); }
});

test('batch submission and polling share one token per connection version', async () => {
  let now = 0;
  let exchanges = 0;
  const executor = createLlmExecutor({ ...opts, now: () => now, fetchImpl: async url => {
    if (url === auth.tokenEndpoint) { exchanges++; return Response.json({ access_token: 'access-sentinel', expires_in: 3600 }); }
    return Response.json({ type: 'message_batch', id: 'remote-batch', processing_status: 'in_progress', request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 } });
  } });
  await executor.createConnection('workspace', { ...config, providerType: 'anthropic', endpoint: 'https://provider.example.test/v1/messages' });
  await executor.submitBatch('workspace', { items: [{ customId: 'one', prompt: 'hello' }] }, { tenantId: 'tenant-a' });
  now = 61_000;
  await executor.batchReconciler.runOnce();
  assert.equal(exchanges, 1);
});
