import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmProviderStore, createLlmExecutor, localMockLlmBackend } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { withLlmServer, config, collection, singular } from './helpers/llm-connections.mjs';

test('singular routes retain their legacy shape and operate only on the current default', async () => {
  await withLlmServer(async request => {
    assert.equal((await request('GET', singular)).body.code, 'LLM_PROVIDER_NOT_FOUND');
    assert.equal((await request('PUT', singular, config)).body.connectionId, 'default');
    await request('POST', collection, { ...config, connectionId: 'named', isDefault: true });
    const updated = await request('PUT', singular, { ...config, providerType: 'anthropic' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.connectionId, 'named');
    const get = await request('GET', singular);
    assert.deepEqual(Object.keys(get.body).sort(), ['tenantId', 'workspaceId', 'connectionId', 'providerType', 'endpoint', 'allowedModels', 'defaultModel', 'secretRef', 'updatedAt'].sort());
    assert.equal(get.body.providerType, 'anthropic');
    assert.equal((await request('GET', `${collection}/default`)).body.providerType, 'openai');
    assert.deepEqual((await request('DELETE', singular)).body, { removed: true });
    assert.equal((await request('GET', singular)).status, 404);
    assert.equal((await request('GET')).body.items.length, 1);
    // No default: promote the existing default-named row, rather than inserting a duplicate.
    assert.equal((await request('PUT', singular, config)).body.connectionId, 'default');
    assert.equal((await request('GET')).body.items.length, 1);
  });
});

test('unselected completions use the default, and no default fails closed with 422', async () => {
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'first' });
    await request('POST', collection, { ...config, connectionId: 'second', allowedModels: ['second-model'], defaultModel: 'second-model', isDefault: true });
    const path = '/v1/workspaces/shared/llm/completions';
    const complete = await request('POST', path, { prompt: 'ping' });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.model, 'second-model');
    await request('DELETE', singular);
    const missing = await request('POST', path, { prompt: 'ping' });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.code, 'LLM_PROVIDER_MISSING');
  });
});

test('singular PUT cannot insert a 33rd connection and makes no changes', async () => {
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'temporary' });
    await request('POST', collection, { ...config, connectionId: 'conn-0' });
    await request('DELETE', `${collection}/temporary`);
    for (let i = 1; i < 32; i++) await request('POST', collection, { ...config, connectionId: `conn-${i}` });
    const before = (await request('GET')).body;
    const result = await request('PUT', singular, config);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'LLM_CONNECTION_LIMIT_REACHED');
    assert.deepEqual((await request('GET')).body, before);
  });
});

const legacyRow = { tenant_id: 't', workspace_id: 'w', provider_type: 'openai', allowed_models: ['m'], default_model: 'm', updated_at: new Date('2026-01-01Z') };
test('worker reads the registry without DDL, and falls back only on SQLSTATE 42P01', async () => {
  for (const tenant of ['t', undefined]) {
    const queries = [];
    const store = createLlmProviderStore({ pool: { async query(sql) {
      queries.push(sql);
      assert.match(sql, /^SELECT /);
      if (sql.includes('workspace_llm_connections')) throw Object.assign(new Error('missing registry'), { code: '42P01' });
      assert.match(sql, /workspace_llm_providers/);
      return { rows: [legacyRow] };
    } } });
    assert.equal((await store.getProvider('w', tenant)).providerType, 'openai');
    assert.equal(queries.length, 2);
    assert.match(queries[0], /is_default/);
  }
  for (const error of [Object.assign(new Error('denied'), { code: '42501' }), new Error('connection unavailable')]) {
    const queries = [];
    const store = createLlmProviderStore({ pool: { async query(sql) { queries.push(sql); throw error; } } });
    await assert.rejects(store.getProvider('w', 't'), e => e === error);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /workspace_llm_connections/);
  }
});

test('registry with no default never reads the legacy table, and completion returns 422', async () => {
  const queries = [];
  const store = createLlmProviderStore({ pool: { async query(sql) { queries.push(sql); return { rows: [] }; } } });
  const executor = createLlmExecutor({ providerStore: store, backendFactory: () => localMockLlmBackend() });
  await assert.rejects(executor.complete('w', { tenantId: 't', prompt: 'ping' }), { statusCode: 422, code: 'LLM_PROVIDER_MISSING' });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /workspace_llm_connections/);
});
