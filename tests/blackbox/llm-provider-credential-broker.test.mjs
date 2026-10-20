import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor, createLlmProviderStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

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
  for (const failure of ['invalid_grant', 401, 403]) {
    const logs = [];
    await withLlmServer(async (request, executor) => {
      assert.equal((await request('PUT', singular, config)).status, 200);
      const response = await request('POST', '/v1/workspaces/shared/llm/completions', { prompt: 'hello', stream: true });
      assert.equal(response.status, 424, JSON.stringify(response));
      assert.equal(response.body.code, 'LLM_PROVIDER_AUTH_FAILED');
      assert.doesNotMatch(response.headers['content-type'], /event-stream/);
      assert.doesNotMatch(JSON.stringify({ response, logs, rows: await executor.listConnections('shared', 'tenant-a'),
        ledger: await executor.getLedger('shared', { tenantId: 'tenant-a' }) }), /sentinel/);
    }, { backendFactory: undefined, logger: { error: (...args) => logs.push(args), info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
      fetchImpl: async url => url === auth.tokenEndpoint
      ? failure === 'invalid_grant' ? Response.json({ error: 'invalid_grant', error_description: 'refresh-sentinel' }, { status: 400 })
        : Response.json({ access_token: 'access-sentinel', expires_in: 3600 })
      : new Response('access-sentinel', { status: failure }) });
  }
});

test('stored identity profile is rechecked against the verified tenant before any exchange', async () => {
  let calls = 0;
  const executor = createLlmExecutor({ ...opts, identityProfiles: {}, fetchImpl: async () => { calls++; return success(); } });
  await executor.providerStore.createConnection('workspace', { ...config, auth: { mode: 'workloadIdentity', profile: 'unknown' } });
  await assert.rejects(executor.complete('workspace', input), { statusCode: 422, code: 'LLM_IDENTITY_PROFILE_NOT_ALLOWED' });
  assert.equal(calls, 0);
});

test('an old registry writer restoring secret_ref switches a brokered row back to API-key auth', async () => {
  let storedAuth = auth;
  // DB boundary: the previous image's item UPDATE replaces secret_ref but does
  // not mention auth/auth_version. Its resulting row is a valid API-key write.
  const providerStore = createLlmProviderStore({ pool: { query: async () => ({ rows: [{
    tenant_id: 'tenant-a', workspace_id: 'workspace', connection_id: 'oauth', is_default: true,
    provider_type: 'openai', endpoint: config.endpoint, allowed_models: ['model-a'], default_model: 'model-a',
    secret_ref: { name: 'BYOK_RESTORED' }, auth: storedAuth, auth_version: 'stale-broker-version',
  }] }) } });
  let exchanges = 0;
  const executor = createLlmExecutor({ ...opts, providerStore, secretResolver: async ref => {
    assert.deepEqual(ref, { name: 'BYOK_RESTORED' });
    return 'restored-key-sentinel';
  }, fetchImpl: async (url, init) => {
    if (url === auth.tokenEndpoint) { exchanges++; return Response.json({ access_token: 'stale-access-sentinel', expires_in: 3600 }); }
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer restored-key-sentinel');
    return success();
  } });
  assert.equal((await executor.getConnection('workspace', 'oauth', 'tenant-a')).auth, undefined);
  assert.equal((await executor.complete('workspace', input)).content, 'hello');
  assert.equal(exchanges, 0);
  storedAuth = { mode: 'apiKey' };
  assert.deepEqual((await executor.getConnection('workspace', 'oauth', 'tenant-a')).auth, storedAuth);
});

test('a secret missing during cached-token 401 recovery retains the fixed 500 error before streaming', async () => {
  let secretAvailable = true;
  let sends = 0;
  let exchanges = 0;
  const executor = createLlmExecutor({ ...opts,
    secretResolver: async () => { if (!secretAvailable) throw new Error('client-sentinel'); return 'client-sentinel'; },
    fetchImpl: async url => {
      if (url === auth.tokenEndpoint) { exchanges++; return Response.json({ access_token: 'access-sentinel', expires_in: 3600 }); }
      return ++sends === 1 ? success() : new Response('access-sentinel', { status: 401 });
    } });
  await executor.createConnection('workspace', config);
  await executor.complete('workspace', input);
  secretAvailable = false;
  await assert.rejects(executor.completeStream('workspace', input).next(), error => error.statusCode === 500
    && error.code === 'LLM_PROVIDER_SECRET_UNRESOLVED' && !error.message.includes('sentinel'));
  assert.equal(exchanges, 1);
  assert.equal(sends, 2);
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

test('brokered batch polling, results and cancellation survive metadata edits on another replica', async () => {
  let now = 0;
  let exchanges = 0;
  const calls = [];
  let ended = false;
  const batchConfig = { ...config, providerType: 'anthropic', endpoint: 'https://provider.example.test/v1/messages' };
  const options = { ...opts, now: () => now, fetchImpl: async (url, init) => {
    if (url === auth.tokenEndpoint) return Response.json({ access_token: `access-${++exchanges}`, expires_in: 3600 });
    calls.push({ url, method: init.method, bearer: new Headers(init.headers).get('authorization') });
    if (url.endsWith('/results')) return new Response(JSON.stringify({ custom_id: 'one', result: { type: 'succeeded', message: {
      type: 'message', model: 'model-a', content: [{ type: 'text', text: 'paid result' }], stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    } } }) + '\n');
    return Response.json({ type: 'message_batch', id: 'remote-batch', processing_status: ended ? 'ended' : 'in_progress',
      request_counts: { processing: ended ? 0 : 1, succeeded: ended ? 1 : 0, errored: 0, canceled: 0, expired: 0 } });
  } };
  const first = createLlmExecutor(options);
  await first.createConnection('workspace', batchConfig);
  const second = createLlmExecutor({ ...options, providerStore: first.providerStore, batchStore: first.batchStore, usageStore: first.usageStore });
  const id = (await second.submitBatch('workspace', { items: [{ customId: 'one', prompt: 'hello' }] }, input)).body.batchId;
  await first.replaceConnection('workspace', 'oauth', { ...batchConfig, displayName: 'Renamed', allowedModels: ['another-model'], defaultModel: 'another-model' });
  now = 60_000;
  await second.reconcileBatches();
  assert.equal(calls.length, 2, 'the paid batch must still be polled');
  assert.equal(exchanges, 2, 'a metadata PUT must not reuse the old-version token');
  assert.equal(calls[1].bearer, 'Bearer access-2');
  await second.cancelBatch('workspace', id, input);
  assert.ok(calls.some(call => call.url.endsWith('/cancel')), 'the paid batch must remain cancellable');
  ended = true;
  now += 60_000;
  await second.reconcileBatches();
  assert.equal((await second.listBatchItems('workspace', id, input)).items[0].content, 'paid result');
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
