import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSecretStore, workspaceSecretPath } from '../../apps/control-plane/vault-secrets.mjs';
import { createConfinedSecretResolver, assertSecretRefAllowed } from '../../apps/control-plane-executor/src/runtime/byok-provider-guard.mjs';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { createEmbeddingExecutor } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';
import { withLlmServer, collection as llmCollection } from './helpers/llm-connections.mjs';
import { buildTenantConfigExport } from '../../apps/control-plane/tenant-config-export.mjs';

// Only the external KV boundary is replaced; resolution uses the real workspace store.
function workspaceStore() {
  const rows = new Map();
  const reads = [];
  const controls = { error: null };
  const store = createWorkspaceSecretStore({
    async writeSecret(path, data) { rows.set(path, { data }); },
    async readSecret(path) {
      reads.push(path);
      if (controls.error) throw controls.error;
      return rows.get(path) ?? null;
    },
  });
  return { store, reads, controls };
}
const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
const ref = { workspaceSecret: 'openai-key' };

test('workspace refs resolve from OpenBao in the verified scope on every request', async () => {
  const { store, reads } = workspaceStore();
  await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'first-placeholder');
  const resolve = createConfinedSecretResolver({ env: {}, workspaceSecretStore: store });
  reads.length = 0;
  assert.equal(await resolve(ref, scope), 'first-placeholder');
  assert.equal(reads.length, 1);
  await store.replace(scope.tenantId, scope.workspaceId, 'openai-key', 'rotated-placeholder');
  reads.length = 0;
  assert.equal(await resolve(ref, scope), 'rotated-placeholder');
  assert.deepEqual(reads, [
    workspaceSecretPath('tenant-a', 'workspace-a', 'openai-key'),
  ]);
});

test('invalid workspace refs are rejected without reading env or KV', async () => {
  const { store, reads } = workspaceStore();
  const env = new Proxy({}, { get() { throw new Error('env must not be read'); } });
  const resolve = createConfinedSecretResolver({ env, prefixes: ['BYOK_'], workspaceSecretStore: store });
  for (const bad of [
    { name: 'BYOK_KEY', workspaceSecret: 'openai-key' },
    ...['Other', '../key', 'a/b', '', null, 1, 'a'.repeat(64)].map(workspaceSecret => ({ workspaceSecret })),
  ]) {
    assert.throws(() => assertSecretRefAllowed(bad), { statusCode: 400, code: 'BYOK_SECRET_REF_NOT_ALLOWED' });
    assert.equal(await resolve(bad, scope), null);
  }
  assert.equal(await resolve(ref), null);
  assert.deepEqual(reads, []);
});

test('workspace resolver fails closed on missing, disabled, wrong scope, and KV errors with bounded logs', async (t) => {
  const { store, controls } = workspaceStore();
  await store.set('other-tenant', 'other-workspace', 'openai-key', 'never-expose-placeholder');
  const env = new Proxy({}, { get() { throw new Error('env must not be read'); } });
  const options = { env, prefixes: ['BYOK_'], workspaceSecretStore: store };
  const resolve = createConfinedSecretResolver(options);
  assert.equal(await resolve(ref, scope), null);
  assert.equal(await createConfinedSecretResolver({ ...options, workspaceSecretStore: null })(ref, scope), null);
  for (const badScope of [{ ...scope, tenantId: '../other-tenant' }, { ...scope, workspaceId: 'a/b' }]) {
    assert.equal(await resolve(ref, badScope), null);
  }
  const logs = [];
  t.mock.method(console, 'error', line => logs.push(line));
  controls.error = Object.assign(new Error('never-expose-placeholder'), { vaultStatus: 503 });
  assert.equal(await resolve(ref, scope), null);
  assert.deepEqual(logs.map(line => JSON.parse(line)), [{ event: 'secret_teardown_failure', operation: 'byok-resolve', status: 503 }]);
});

const llmConfig = { tenantId: scope.tenantId, providerType: 'openai', endpoint: 'https://provider.example/v1/chat/completions',
  allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: ref };
const completeInput = { tenantId: scope.tenantId, prompt: 'hello' };
const executorOptions = { guardEnv: {}, endpointResolver: async () => ['93.184.216.34'] };

test('completion sends current workspace key as bearer token using the verified connection scope', async () => {
  const { store, reads } = workspaceStore();
  await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'first-placeholder');
  const auth = [];
  const executor = createLlmExecutor({ ...executorOptions, workspaceSecretStore: store,
    async fetchImpl(url, init) {
      auth.push(init.headers.Authorization ?? init.headers.authorization);
      return Response.json({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: {} });
    },
  });
  await executor.setProvider(scope.workspaceId, llmConfig);
  reads.length = 0;
  assert.equal((await executor.complete(scope.workspaceId, completeInput)).content, 'hello');
  assert.equal(reads.length, 1);
  await store.replace(scope.tenantId, scope.workspaceId, 'openai-key', 'rotated-placeholder');
  reads.length = 0;
  await executor.complete(scope.workspaceId, completeInput);
  assert.equal(reads.length, 1);
  assert.deepEqual(auth, ['Bearer first-placeholder', 'Bearer rotated-placeholder']);
  assert.ok(reads.every(path => path === workspaceSecretPath(scope.tenantId, scope.workspaceId, 'openai-key')));
});

const embeddingConfig = { tenantId: scope.tenantId, providerType: 'openai', model: 'fixture-embedding',
  endpoint: 'https://provider.example/v1/embeddings', secretRef: ref };
test('embedding sends current workspace key on each request', async () => {
  const { store, reads } = workspaceStore();
  await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'first-placeholder');
  const auth = [];
  const executor = createEmbeddingExecutor({ ...executorOptions, workspaceSecretStore: store,
    async fetchImpl(url, init) {
      auth.push(init.headers.Authorization);
      return Response.json({ data: [{ embedding: [0.1, 0.2] }] });
    },
  });
  await executor.deployProvider(scope.workspaceId, embeddingConfig);
  reads.length = 0;
  assert.deepEqual(await executor.embedForWorkspace(scope.workspaceId, 'hello', { tenantId: scope.tenantId }), [0.1, 0.2]);
  assert.equal(reads.length, 1);
  await store.replace(scope.tenantId, scope.workspaceId, 'openai-key', 'rotated-placeholder');
  reads.length = 0;
  await executor.embedForWorkspace(scope.workspaceId, 'hello', { tenantId: scope.tenantId });
  assert.equal(reads.length, 1);
  assert.deepEqual(auth, ['Bearer first-placeholder', 'Bearer rotated-placeholder']);
});

for (const [plane, make, config] of [['LLM', createLlmExecutor, llmConfig], ['embedding', createEmbeddingExecutor, embeddingConfig]]) {
  test(`${plane} deploy/create/replace reject invalid or missing workspace refs without persisting`, async () => {
    const { store } = workspaceStore();
    await store.set('other-tenant', 'other-workspace', 'openai-key', 'other-placeholder');
    const executor = make({ ...executorOptions, workspaceSecretStore: store });
    const legacy = plane === 'LLM' ? executor.setProvider : executor.deployProvider;
    const list = () => executor.listConnections(scope.workspaceId, scope.tenantId);
    const operations = [
      (secretRef) => legacy(scope.workspaceId, { ...config, secretRef }),
      (secretRef) => executor.createConnection(scope.workspaceId, { ...config, connectionId: 'named', secretRef }),
    ];
    for (const operation of operations) {
      for (const secretRef of [{ workspaceSecret: 'Bad' }, { workspaceSecret: '../key' }, { workspaceSecret: 'a/b' }, { name: 'BYOK_KEY', ...ref }]) {
        await assert.rejects(() => operation(secretRef), { statusCode: 400, code: 'BYOK_SECRET_REF_NOT_ALLOWED' });
        assert.deepEqual(await list(), []);
      }
      await assert.rejects(() => operation(ref), { statusCode: 422, code: 'BYOK_WORKSPACE_SECRET_NOT_FOUND' });
      assert.deepEqual(await list(), []);
    }
    await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'own-placeholder');
    await executor.createConnection(scope.workspaceId, { ...config, connectionId: 'named' });
    const prior = await executor.getConnection(scope.workspaceId, 'named', scope.tenantId);
    for (const [secretRef, expected] of [
      [{ ...ref, name: 'BYOK_KEY' }, { statusCode: 400, code: 'BYOK_SECRET_REF_NOT_ALLOWED' }],
      [{ workspaceSecret: 'missing' }, { statusCode: 422, code: 'BYOK_WORKSPACE_SECRET_NOT_FOUND' }],
    ]) {
      await assert.rejects(() => executor.replaceConnection(scope.workspaceId, 'named', { ...config, secretRef }), expected);
      assert.deepEqual(await executor.getConnection(scope.workspaceId, 'named', scope.tenantId), prior);
    }
  });
}

for (const [plane, make, config, code] of [
  ['LLM', createLlmExecutor, llmConfig, 'LLM_PROVIDER_SECRET_UNRESOLVED'],
  ['embedding', createEmbeddingExecutor, embeddingConfig, 'EMBEDDING_SECRET_UNRESOLVED'],
]) {
  test(`${plane} persisted workspace refs fail closed on missing, disabled and errored stores`, async (t) => {
    const logs = [];
    t.mock.method(console, 'error', line => logs.push(line));
    for (const mode of ['other-tenant', 'other-workspace', 'disabled', 'error', 'dual', 'invalid']) {
      const { store, controls } = workspaceStore();
      await store.set(mode === 'other-tenant' ? 'tenant-b' : scope.tenantId,
        mode === 'other-workspace' ? 'workspace-b' : scope.workspaceId, 'openai-key', 'never-expose-placeholder');
      if (mode === 'error') controls.error = new Error('never-expose-placeholder');
      let calls = 0;
      const env = { BYOK_KEY: 'never-expose-placeholder' };
      const executor = make({ ...executorOptions, guardEnv: env,
        workspaceSecretStore: mode === 'disabled' ? null : store,
        fetchImpl() { calls++; throw new Error('unexpected provider request'); },
      });
      const providerStore = executor.providerStore ?? executor.store;
      const secretRef = mode === 'dual' ? { ...ref, name: 'BYOK_KEY' }
        : mode === 'invalid' ? { workspaceSecret: '../key' } : { ...ref, tenantId: 'tenant-b', workspaceId: 'workspace-b' };
      // Simulate an existing connection; deploy-time checks cannot protect older rows.
      await providerStore.deployProvider(scope.workspaceId, { ...config, secretRef });
      const request = () => plane === 'LLM' ? executor.complete(scope.workspaceId, completeInput)
        : executor.embedForWorkspace(scope.workspaceId, 'hello', { tenantId: scope.tenantId });
      await assert.rejects(request, err => {
        assert.equal(err.statusCode, 500);
        assert.equal(err.code, code);
        assert.ok(!err.message.includes('never-expose-placeholder'));
        return true;
      });
      assert.equal(calls, 0);
    }
    assert.ok(!JSON.stringify(logs).includes('never-expose-placeholder'));
  });
}

test('embedding provider transport errors cannot echo the resolved bearer token', async () => {
  const { store } = workspaceStore();
  await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'never-expose-placeholder');
  const executor = createEmbeddingExecutor({ ...executorOptions, workspaceSecretStore: store,
    fetchImpl() { throw new Error('transport included never-expose-placeholder'); },
  });
  await executor.deployProvider(scope.workspaceId, embeddingConfig);
  await assert.rejects(() => executor.embedForWorkspace(scope.workspaceId, 'hello', { tenantId: scope.tenantId }), error => {
    assert.equal(error.code, 'EMBEDDING_PROVIDER_ERROR');
    assert.ok(!error.message.includes('never-expose-placeholder'));
    return true;
  });
});


test('HTTP deploy/GET/list/completion/export and error responses never expose the workspace value', async (t) => {
  const { store, controls } = workspaceStore();
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(console, 'log', (...args) => logs.push(args));
  await store.set('tenant-a', 'shared', 'openai-key', 'never-expose-placeholder');
  const responses = [];
  await withLlmServer(async request => {
    const body = { ...llmConfig, connectionId: 'named', tenantId: 'forged', workspaceId: 'forged' };
    const created = await request('POST', llmCollection, body);
    assert.equal(created.status, 201);
    assert.equal(created.body.tenantId, 'tenant-a');
    assert.equal(created.body.workspaceId, 'shared');
    responses.push(created, await request('GET'), await request('GET', `${llmCollection}/named`));
    const completion = await request('POST', '/v1/workspaces/shared/llm/completions', { prompt: 'hello' });
    assert.equal(completion.status, 200);
    responses.push(completion);
    controls.error = new Error('never-expose-placeholder');
    const failed = await request('POST', '/v1/workspaces/shared/llm/completions', { prompt: 'hello' });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.code, 'LLM_PROVIDER_SECRET_UNRESOLVED');
    responses.push(failed);
    const deployFailed = await request('PUT', `${llmCollection}/named`, body);
    assert.equal(deployFailed.status, 500);
    responses.push(deployFailed);
    responses.push(await request('GET'));
    responses.push(buildTenantConfigExport({ tenant: { id: 'tenant-a' }, workspaces: [created.body] }));
  }, { workspaceSecretStore: store, secretResolver: undefined, backendFactory: undefined,
    fetchImpl: async () => Response.json({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: {} }),
  });
  assert.ok(!JSON.stringify({ responses, logs }).includes('never-expose-placeholder'));
});

test('batch reconciliation uses the rotated snapshot key and persists only the reference', async (t) => {
  const { store, controls } = workspaceStore();
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'first-placeholder');
  let time = Date.parse('2026-10-18T00:00:00Z');
  const auth = [];
  const executor = createLlmExecutor({ ...executorOptions, workspaceSecretStore: store, now: () => time,
    async fetchImpl(url, init) {
      auth.push(new Headers(init.headers).get('x-api-key'));
      return Response.json({ type: 'message_batch', id: 'provider-batch', processing_status: 'in_progress',
        request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, expires_at: '2026-10-19T00:00:00Z' });
    },
  });
  const deployed = await executor.setProvider(scope.workspaceId, { ...llmConfig, providerType: 'anthropic', endpoint: 'https://provider.example/messages' });
  const submitted = await executor.submitBatch(scope.workspaceId, { items: [{ customId: 'one', prompt: 'hello' }] }, { tenantId: scope.tenantId });
  const id = submitted.body.batchId;
  await store.replace(scope.tenantId, scope.workspaceId, 'openai-key', 'rotated-placeholder');
  // A changed connection must not change the batch snapshot scope/ref.
  await store.set(scope.tenantId, scope.workspaceId, 'new-key', 'other-placeholder');
  await executor.replaceConnection(scope.workspaceId, 'default', { ...llmConfig, providerType: 'anthropic', secretRef: { workspaceSecret: 'new-key' } });
  time += 60000;
  await executor.reconcileBatches();
  assert.deepEqual(auth, ['first-placeholder', 'rotated-placeholder']);
  controls.error = new Error('rotated-placeholder');
  time += 60000;
  await executor.reconcileBatches();
  assert.equal(auth.length, 2);
  const row = await executor.batchStore.get(scope.workspaceId, id, scope.tenantId);
  assert.equal(row.lastErrorCode, 'LLM_PROVIDER_SECRET_UNRESOLVED');
  assert.deepEqual(row.secretRef, ref);
  const evidence = [deployed, submitted, row, await executor.listBatchItems(scope.workspaceId, id, { tenantId: scope.tenantId }), logs];
  for (const value of ['first-placeholder', 'rotated-placeholder', 'other-placeholder']) assert.ok(!JSON.stringify(evidence).includes(value));
});

test('embedding malformed provider response cannot echo credentials in a parser error', async () => {
  const { store } = workspaceStore();
  await store.set(scope.tenantId, scope.workspaceId, 'openai-key', 'never-expose-placeholder');
  const executor = createEmbeddingExecutor({ ...executorOptions, workspaceSecretStore: store,
    fetchImpl: async () => new Response('never-expose-placeholder'),
  });
  await executor.deployProvider(scope.workspaceId, embeddingConfig);
  await assert.rejects(() => executor.embedForWorkspace(scope.workspaceId, 'hello', { tenantId: scope.tenantId }), error => {
    assert.equal(error.code, 'EMBEDDING_PROVIDER_ERROR');
    assert.ok(!error.message.includes('never-expose-placeholder'));
    return true;
  });
});
