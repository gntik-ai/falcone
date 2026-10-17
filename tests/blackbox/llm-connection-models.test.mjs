import test from 'node:test';
import assert from 'node:assert/strict';
import { withLlmServer, config, collection } from './helpers/llm-connections.mjs';

const path = `${collection}/main/models`;
const unknownCapabilities = {
  contextWindow: null, maxOutputTokens: null, streaming: null, structuredOutput: null,
  toolUse: null, batch: null, promptCaching: null, inputModalities: null, pricingRef: null,
};

test('GET models derives unresolved allow-list entries without provider discovery', async () => {
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'main' });
    const response = await request('GET', path);
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.catalogVersion, 'string');
    assert.deepEqual(response.body.items, [{
      modelId: 'model-a', displayName: null, idSource: 'allowList', capabilitySource: 'unresolved',
      selectable: true, capabilities: unknownCapabilities,
      lifecycle: { state: null, retiresAt: null, effectiveState: null },
    }]);
  });
});

test('PUT replaces the snapshot and selectable ids together, preserving state on invalid input', async () => {
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'main' });
    const update = { models: [
      { modelId: 'z-manual', displayName: 'Zed', capabilities: { streaming: false } },
      { modelId: 'model-a', lifecycle: { state: 'retired' } },
    ], selectable: ['model-a'] };
    assert.equal((await request('PUT', path, update)).status, 200);
    const listed = await request('GET', path);
    assert.deepEqual(listed.body.items.map(m => [m.modelId, m.selectable, m.idSource]), [
      ['model-a', true, 'manual'], ['z-manual', false, 'manual'],
    ]);
    assert.equal(listed.body.items[0].lifecycle.effectiveState, 'retired');
    assert.equal(listed.body.items[1].capabilitySource, 'manual');
    assert.equal((await request('GET', `${collection}/main`)).body.allowedModels[0], 'model-a');
    for (const body of [
      { models: [{ modelId: 'model-a' }], selectable: [] },
      { models: [{ modelId: 'model-a' }], selectable: ['model-a', 'unlisted'] },
    ]) {
      const denied = await request('PUT', path, body);
      assert.equal(denied.status, 409);
      assert.equal(denied.body.code, 'LLM_DEFAULT_MODEL_NOT_SELECTABLE');
      assert.deepEqual((await request('GET', path)).body, listed.body);
    }
    for (const models of [Array.from({ length: 257 }, (_, i) => ({ modelId: `m-${i}` })),
      ...['', '-bad', 'bad space', 'a'.repeat(129), 'bad\n'].map(modelId => [{ modelId }]),
      [{ modelId: 'model-a', capabilities: { streaming: 'false' } }],
      [{ modelId: 'model-a', lifecycle: { state: 'unknown' } }],
    ]) {
      assert.equal((await request('PUT', path, { models, selectable: ['model-a'] })).status, 400);
      assert.deepEqual((await request('GET', path)).body, listed.body);
    }
    assert.equal((await request('PUT', path, { models: [{ modelId: 'model-a' }], selectable: ['model-a'], tenantId: 'forged' })).status, 200);
    assert.equal((await request('GET', path)).body.items.length, 1);
  });
});

test('refresh merges manual values over the catalog and never fetches', async () => {
  const modelCatalog = { catalogVersion: 'test-v2', entries: { openai: {
    'model-a': { capabilities: { contextWindow: 4096, streaming: true }, lifecycle: { state: 'deprecated' } },
    'catalog-only': { capabilities: { maxOutputTokens: 512 }, lifecycle: { state: 'active' } },
    'not-selected': { capabilities: { streaming: true } },
  } } };
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'main' });
    const put = await request('PUT', path, {
      models: [{ modelId: 'model-a', capabilities: { streaming: false, contextWindow: null } }],
      selectable: ['model-a', 'catalog-only', 'unknown'],
    });
    assert.equal(put.status, 409);
    assert.equal((await request('PUT', path, {
      models: [{ modelId: 'model-a', capabilities: { streaming: false, contextWindow: null } }, { modelId: 'unknown' }],
      selectable: ['model-a', 'catalog-only', 'unknown'],
    })).status, 200);
    const refresh = await request('POST', `${path}/refresh`);
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.catalogVersion, 'test-v2');
    assert.deepEqual(refresh.body.items.map(m => m.modelId), ['catalog-only', 'model-a', 'unknown']);
    assert.equal(refresh.body.items[0].idSource, 'allowList');
    assert.equal(refresh.body.items[0].capabilitySource, 'catalog');
    assert.equal(refresh.body.items[0].capabilities.maxOutputTokens, 512);
    assert.equal(refresh.body.items[1].capabilities.streaming, false);
    assert.equal(refresh.body.items[1].capabilities.contextWindow, 4096);
    assert.equal(refresh.body.items[1].lifecycle.state, 'deprecated');
    assert.equal(refresh.body.items[2].capabilitySource, 'unresolved');
    assert.deepEqual(refresh.body.items[2].capabilities, unknownCapabilities);
    assert.deepEqual((await request('GET', path)).body, refresh.body);
  }, { modelCatalog, fetchImpl() { assert.fail('catalog refresh must not fetch'); } });
});

test('model routes enforce structural writes, tenant ownership, missing connections and cascades', async () => {
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'main' });
    const snapshot = { models: [{ modelId: 'model-a' }], selectable: ['model-a'] };
    await request('PUT', path, snapshot);
    const before = (await request('GET', path)).body;
    for (const identity of [{ apikey: 'flc_boundary' }, { 'x-actor-roles': 'workspace_viewer' },
      { 'x-actor-roles': 'workspace_developer' }, { 'x-actor-roles': 'workspace_admin', 'x-workspace-id': 'other' }]) {
      assert.equal((await request('PUT', path, snapshot, identity)).status, 403);
      assert.equal((await request('POST', `${path}/refresh`, {}, identity)).status, 403);
    }
    assert.deepEqual((await request('GET', path)).body, before);
    assert.equal((await request('GET', path, undefined, { 'x-actor-roles': 'workspace_viewer' })).status, 200);
    for (const identity of [{ 'x-tenant-id': 'tenant-b' }, {}]) {
      const target = identity['x-tenant-id'] ? path : `${collection}/absent/models`;
      for (const [method, targetPath, body] of [['GET', target], ['PUT', target, snapshot], ['POST', `${target}/refresh`]]) {
        const response = await request(method, targetPath, body, identity);
        assert.equal(response.status, 404);
        assert.equal(response.body.code, 'LLM_CONNECTION_NOT_FOUND');
      }
    }
    await request('DELETE', `${collection}/main`);
    await request('POST', collection, { ...config, connectionId: 'main' });
    assert.equal((await request('GET', path)).body.items[0].idSource, 'allowList');
    await request('PUT', path, snapshot);
    await request('DELETE', '/v1/workspaces/shared/llm-provider');
    await request('POST', collection, { ...config, connectionId: 'main' });
    assert.equal((await request('GET', path)).body.items[0].idSource, 'allowList');
  });
});

test('pre-upgrade Postgres model reads return no entries without running DDL', async () => {
  const { createLlmProviderStore } = await import('../../apps/control-plane-executor/src/runtime/llm-executor.mjs');
  const store = createLlmProviderStore({ pool: { async query(sql) {
    assert.match(sql, /^SELECT /);
    throw Object.assign(new Error('table absent'), { code: '42P01' });
  } } });
  assert.deepEqual(await store.listModels('shared', 'main', 'tenant-a'), []);
  const broken = createLlmProviderStore({ pool: { async query() { throw Object.assign(new Error('not permitted'), { code: '42501' }); } } });
  await assert.rejects(broken.listModels('shared', 'main', 'tenant-a'), { code: '42501' });
});

test('PUT accepts 256 models and the full model identifier alphabet', async () => {
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'main' });
    const models = [
      { modelId: 'model-a' }, { modelId: 'A.provider_model:family/version-1' }, { modelId: 'a'.repeat(128) },
      ...Array.from({ length: 253 }, (_, i) => ({ modelId: `fixture-${i}` })),
    ];
    const response = await request('PUT', path, { models, selectable: ['model-a', 'A.provider_model:family/version-1'] });
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 256);
    assert.equal(response.body.items.filter(item => item.selectable).length, 2);
  });
});
