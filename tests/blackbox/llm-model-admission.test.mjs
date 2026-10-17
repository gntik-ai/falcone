import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor, createLlmProviderStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { llmComplete } from '../../apps/workflow-worker/src/activities/index.mjs';

async function setup(metadata = {}, providerType = 'openai-responses') {
  const providerStore = createLlmProviderStore();
  await providerStore.createConnection('ws', {
    tenantId: 'tenant', connectionId: 'main', providerType, allowedModels: ['model-a'], defaultModel: 'model-a',
    endpoint: 'https://example.test/completion', secretRef: { name: 'BYOK_TEST' },
  });
  if (metadata !== null) await providerStore.replaceModels('ws', 'main', {
    tenantId: 'tenant', models: [{ modelId: 'model-a', ...metadata }], selectable: ['model-a'],
  });
  const calls = { backend: 0, secret: 0, endpoint: 0, factory: 0 };
  const executor = createLlmExecutor({
    providerStore,
    endpointResolver: async () => { calls.endpoint++; return ['93.184.216.34']; },
    secretResolver: () => { calls.secret++; return 'test-placeholder'; },
    backendFactory: () => {
      calls.factory++;
      return {
        async complete() { calls.backend++; return { content: '{}', finishReason: 'stop' }; },
        async *stream() { calls.backend++; yield { type: 'usage', usage: {} }; },
      };
    },
  });
  return { executor, calls };
}
const request = { tenantId: 'tenant', prompt: 'hello' };
async function stream(executor, options) {
  for await (const frame of executor.completeStream('ws', { ...request, ...options })) void frame;
}

test('retired models fail before endpoint, secret or backend access, including workflow activity', async () => {
  for (const lifecycle of [{ state: 'retired' }, { state: 'active', retiresAt: '2000-01-01T00:00:00Z' }]) {
    const { executor, calls } = await setup({ lifecycle });
    for (const invoke of [() => executor.complete('ws', request), () => stream(executor)]) {
      await assert.rejects(invoke, { statusCode: 422, code: 'MODEL_RETIRED' });
      assert.deepEqual(calls, { backend: 0, secret: 0, endpoint: 0, factory: 0 });
    }
    await assert.rejects(llmComplete({ params: { model: 'model-a', prompt: 'hello' }, tenant: { tenantId: 'tenant', workspaceId: 'ws' } }, {
      executeLlmComplete: () => executor.complete('ws', request),
    }), { type: 'MODEL_RETIRED', nonRetryable: true });
    assert.deepEqual(calls, { backend: 0, secret: 0, endpoint: 0, factory: 0 });
  }
});

const responseFormat = { type: 'json_schema', name: 'answer', schema: { type: 'object' } };
for (const [capability, capabilities, options] of [
  ['streaming', { streaming: false }, { stream: true }],
  ['maxOutputTokens', { maxOutputTokens: 64 }, { maxTokens: 65 }],
  ['structuredOutput', { structuredOutput: false }, { responseFormat }],
  ['promptCaching', { promptCaching: false }, { promptCache: 'system' }],
]) {
  test(`explicitly unavailable ${capability} rejects before endpoint, secret or provider access`, async () => {
    const { executor, calls } = await setup({ capabilities });
    const verify = error => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.code, 'MODEL_CAPABILITY_UNAVAILABLE');
      assert.match(error.message, new RegExp(capability));
      return true;
    };
    await assert.rejects(() => executor.complete('ws', { ...request, ...options }), verify);
    await assert.rejects(() => stream(executor, options), verify);
    assert.deepEqual(calls, { backend: 0, secret: 0, endpoint: 0, factory: 0 });
    await assert.rejects(llmComplete({ params: { model: 'model-a', prompt: 'hello', ...options }, tenant: { tenantId: 'tenant', workspaceId: 'ws' } }, {
      executeLlmComplete: () => executor.complete('ws', { ...request, ...options }),
    }), { type: 'MODEL_CAPABILITY_UNAVAILABLE', nonRetryable: true });
    assert.deepEqual(calls, { backend: 0, secret: 0, endpoint: 0, factory: 0 });
  });
}

test('missing or null capabilities, deprecated models and future retirement dates allow completion and streams', async () => {
  for (const metadata of [null, {}, { capabilities: { streaming: null, structuredOutput: null, promptCaching: null, maxOutputTokens: null } },
    { lifecycle: { state: 'deprecated' } }, { lifecycle: { state: 'active', retiresAt: '2999-01-01T00:00:00Z' } }]) {
    const { executor, calls } = await setup(metadata);
    const options = { ...request, maxTokens: 1024, responseFormat, promptCache: 'system' };
    assert.equal((await executor.complete('ws', options)).content, '{}');
    await stream(executor, options);
    assert.deepEqual(calls, { backend: 2, secret: 2, endpoint: 2, factory: 2 });
  }
  const { executor } = await setup({ capabilities: { streaming: false, maxOutputTokens: 64 } });
  assert.equal((await executor.complete('ws', { ...request, maxTokens: 64 })).content, '{}');
});

test('existing prompt cache, adapter support and allow-list error precedence is preserved', async () => {
  const { executor, calls } = await setup({ lifecycle: { state: 'retired' } }, 'openai');
  await assert.rejects(executor.complete('ws', { ...request, model: 'not-allowed', promptCache: 'invalid' }), { code: 'INVALID_PROMPT_CACHE' });
  await assert.rejects(executor.complete('ws', { ...request, model: 'not-allowed', responseFormat }), { code: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED' });
  await assert.rejects(executor.complete('ws', { ...request, model: 'not-allowed' }), { code: 'MODEL_NOT_ALLOWED' });
  assert.deepEqual(calls, { backend: 0, secret: 0, endpoint: 0, factory: 0 });
});

test('admission uses the injected catalog for allow-list ids with no stored row', async () => {
  const providerStore = createLlmProviderStore();
  await providerStore.createConnection('ws', { tenantId: 'tenant', connectionId: 'main', providerType: 'openai', allowedModels: ['model-a'] });
  const executor = createLlmExecutor({ providerStore,
    modelCatalog: { catalogVersion: 'test-v1', entries: { openai: { 'model-a': { lifecycle: { state: 'retired' } } } } },
    secretResolver() { assert.fail('secret access'); }, backendFactory() { assert.fail('backend access'); },
  });
  await assert.rejects(executor.complete('ws', { ...request, model: 'model-a' }), { code: 'MODEL_RETIRED' });
});

test('worker admission falls back to the allow-list when the model table is absent', async () => {
  const providerStore = createLlmProviderStore({ pool: { async query(sql) {
    assert.match(sql, /^SELECT /);
    if (sql.includes('FROM workspace_llm_connection_models')) throw Object.assign(new Error('table absent'), { code: '42P01' });
    return { rows: [{ tenant_id: 'tenant', workspace_id: 'ws', connection_id: 'main',
      provider_type: 'openai', allowed_models: ['model-a'], default_model: 'model-a',
      secret_ref: { name: 'BYOK_TEST' } }] };
  } } });
  const executor = createLlmExecutor({ providerStore,
    secretResolver: () => 'test-placeholder',
    backendFactory: () => ({ async complete() { return { content: 'allowed' }; } }),
  });
  assert.equal((await executor.complete('ws', request)).content, 'allowed');
});
