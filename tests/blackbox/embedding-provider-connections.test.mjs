import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingMappingStore } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';
import { withEmbeddingServer, config, collection, dataRegistry, mappingPath, mapping } from './helpers/embedding-connections.mjs';

test('two named connections coexist and are listed in connectionId order', async () => {
  await withEmbeddingServer(async request => {
    const first = await request('POST', collection, { ...config, connectionId: 'openai-main' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.isDefault, true);
    assert.equal((await request('POST', collection, { ...config, providerType: 'anthropic', connectionId: 'anthropic-main' })).status, 201);
    const list = await request('GET');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map(r => r.connectionId), ['anthropic-main', 'openai-main']);
    assert.deepEqual(list.body.items.map(r => r.providerType), ['anthropic', 'openai']);
    assert.deepEqual((await request('GET', `${collection}/openai-main`)).body, first.body);
  });
});

test('defaults move atomically through PUT and POST; deleting the default leaves none', async () => {
  await withEmbeddingServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'first' });
    await request('POST', collection, { ...config, connectionId: 'second' });
    const moved = await request('PUT', `${collection}/second`, { ...config, isDefault: true, displayName: 'Second' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.displayName, 'Second');
    assert.match(moved.body.warning, /re-indexing/);
    assert.deepEqual((await request('GET')).body.items.filter(r => r.isDefault).map(r => r.connectionId), ['second']);
    const denied = await request('PUT', `${collection}/second`, { ...config, isDefault: false });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'EMBEDDING_DEFAULT_REQUIRED');
    assert.equal((await request('PUT', `${collection}/second`, config)).body.isDefault, true);
    await request('POST', collection, { ...config, connectionId: 'third', isDefault: true });
    assert.deepEqual((await request('GET')).body.items.filter(r => r.isDefault).map(r => r.connectionId), ['third']);
    const removed = await request('DELETE', `${collection}/third`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { removed: true });
    assert.equal((await request('GET')).body.items.filter(r => r.isDefault).length, 0);
  });
});

test('identifiers, duplicates, missing items, display names and the 32 connection cap', async () => {
  await withEmbeddingServer(async request => {
    for (const id of ['Bad', '-bad', 'a'.repeat(64), 'bad_id', '']) {
      const r = await request('POST', collection, { ...config, connectionId: id });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'INVALID_CONNECTION_ID');
    }
    const tooLong = await request('POST', collection, { ...config, connectionId: 'long', displayName: 'x'.repeat(129) });
    assert.equal(tooLong.status, 400);
    for (const id of ['missing', 'Bad', '-bad', 'bad_id']) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const r = await request(method, `${collection}/${id}`, method === 'PUT' ? config : undefined);
        assert.equal(r.status, 404);
        assert.equal(r.body.code, 'EMBEDDING_CONNECTION_NOT_FOUND');
      }
    }
    for (let i = 0; i < 32; i++) assert.equal((await request('POST', collection, { ...config, connectionId: `conn-${i}` })).status, 201);
    const duplicate = await request('POST', collection, { ...config, connectionId: 'conn-0' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'EMBEDDING_CONNECTION_EXISTS');
    const before = (await request('GET')).body;
    const overflow = await request('POST', collection, { ...config, connectionId: 'overflow', isDefault: true });
    assert.equal(overflow.status, 409);
    assert.equal(overflow.body.code, 'EMBEDDING_CONNECTION_LIMIT_REACHED');
    assert.deepEqual((await request('GET')).body, before);
    assert.equal((await request('PUT', `${collection}/conn-1`, { ...config, isDefault: true })).status, 200);
  });
});

test('rejected secret references and endpoints write nothing; plaintext keys are stripped', async () => {
  await withEmbeddingServer(async request => {
    for (const bad of [{ secretRef: { name: 'DATABASE_PASSWORD' } }, { endpoint: 'http://127.0.0.1/private' }]) {
      const r = await request('POST', collection, { ...config, ...bad, connectionId: 'bad' });
      assert.equal(r.status, 400);
      assert.deepEqual((await request('GET')).body.items, []);
    }
    const created = await request('POST', collection, { ...config, connectionId: 'safe', apiKey: 'plaintext-marker', key: 'plaintext-marker', secret: 'plaintext-marker' });
    assert.equal(created.status, 201);
    const before = (await request('GET')).body;
    for (const bad of [{ secretRef: { name: 'DATABASE_PASSWORD' } }, { endpoint: 'http://127.0.0.1/private' }]) {
      assert.equal((await request('PUT', `${collection}/safe`, { ...config, ...bad })).status, 400);
      assert.deepEqual((await request('GET')).body, before);
    }
    assert.ok(!JSON.stringify(before).includes('plaintext-marker'));
    assert.deepEqual(before.items[0].secretRef, { name: 'BYOK_TEST' });
  });
});

test('all structural writes enforce roles and workspace bindings; identity owns tenantId', async () => {
  await withEmbeddingServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'existing' });
    const before = (await request('GET')).body;
    const denied = [
      { 'x-actor-roles': 'workspace_viewer' }, { 'x-actor-roles': 'workspace_developer' },
      { 'x-actor-roles': '' }, { 'x-actor-roles': 'workspace_admin', 'x-workspace-id': 'other' },
      { 'x-actor-roles': 'workspace_owner', 'x-workspace-id': 'other' },
      { 'x-actor-roles': 'workspace_admin', 'x-workspace-id': '', 'x-actor-workspace-ids': 'other' },
      { apikey: 'flc_test_boundary' },
    ];
    for (const identity of denied) {
      for (const [method, path, body] of [
        ['POST', collection, { ...config, connectionId: 'denied' }],
        ['PUT', `${collection}/existing`, config], ['DELETE', `${collection}/existing`, undefined],
      ]) assert.equal((await request(method, path, body, identity)).status, 403, `${method} ${JSON.stringify(identity)}`);
    }
    assert.deepEqual((await request('GET')).body, before);
    for (const role of ['workspace_admin', 'workspace_owner']) {
      const created = await request('POST', collection, { ...config, connectionId: role.replace('_', '-'), tenantId: 'forged' }, { 'x-actor-roles': role });
      assert.equal(created.status, 201);
      assert.equal(created.body.tenantId, 'tenant-a');
    }
    const other = { 'x-tenant-id': 'tenant-b' };
    assert.deepEqual((await request('GET', collection, undefined, other)).body.items, []);
    assert.equal((await request('GET', `${collection}/existing`, undefined, other)).status, 404);
    assert.equal((await request('POST', collection, { ...config, connectionId: 'existing', providerType: 'anthropic' }, other)).status, 201);
    assert.equal((await request('GET', `${collection}/existing`)).body.providerType, 'openai');
  });
});

test('mapping PUT validates the named connection in the tenant and GET carries it', async () => {
  await withEmbeddingServer(async request => {
    const missing = await request('PUT', mappingPath, { ...mapping, connectionId: 'missing' });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.code, 'EMBEDDING_CONNECTION_NOT_FOUND');
    assert.equal((await request('GET', mappingPath)).status, 404);
    await request('POST', collection, { ...config, connectionId: 'named' });
    const put = await request('PUT', mappingPath, { ...mapping, connectionId: 'named' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.connectionId, 'named');
    assert.equal((await request('GET', mappingPath)).body.connectionId, 'named');
    const foreign = await request('PUT', mappingPath, { ...mapping, connectionId: 'named' }, { 'x-tenant-id': 'tenant-b' });
    assert.equal(foreign.status, 422);
    assert.equal((await request('GET', mappingPath)).body.connectionId, 'named');
  }, { registry: dataRegistry() });
});

test('named mappings block plural and singular deletion without changing connections', async () => {
  await withEmbeddingServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'first' });
    await request('POST', collection, { ...config, connectionId: 'second' });
    for (const [connectionId, path] of [['second', `${collection}/second`], ['first', '/v1/workspaces/shared/embedding-provider']]) {
      await request('PUT', mappingPath, { ...mapping, connectionId });
      const before = (await request('GET')).body;
      const denied = await request('DELETE', path);
      assert.equal(denied.status, 409);
      assert.equal(denied.body.code, 'EMBEDDING_CONNECTION_IN_USE');
      assert.deepEqual((await request('GET')).body, before);
    }
    // An unselected mapping follows the current default and does not block deletion.
    await request('PUT', mappingPath, mapping);
    assert.equal((await request('DELETE', '/v1/workspaces/shared/embedding-provider')).status, 200);
    const missing = await request('POST', mappingPath.replace('/embedding-mapping', '/search'), { queryText: 'hello' });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.code, 'EMBEDDING_PROVIDER_MISSING');
  }, { registry: dataRegistry() });
});

test('auto-embed writes and queryText KNN use the mapped endpoint, with default fallback', async () => {
  const endpoints = [];
  await withEmbeddingServer(async request => {
    const defaultEndpoint = 'https://example.test/default';
    const namedEndpoint = 'https://example.test/named';
    await request('POST', collection, { ...config, connectionId: 'first', endpoint: defaultEndpoint });
    await request('POST', collection, { ...config, connectionId: 'named', endpoint: namedEndpoint });
    const rows = mappingPath.replace('/embedding-mapping', '/rows');
    const search = mappingPath.replace('/embedding-mapping', '/search');
    for (const [connectionId, endpoint] of [['named', namedEndpoint], [undefined, defaultEndpoint]]) {
      assert.equal((await request('PUT', mappingPath, { ...mapping, connectionId })).status, 200);
      endpoints.length = 0;
      const inserted = await request('POST', rows, { body: 'hello' });
      assert.equal(inserted.status, 201, JSON.stringify(inserted.body));
      const found = await request('POST', search, { queryText: 'hello', vectorColumn: 'embedding' });
      assert.equal(found.status, 200, JSON.stringify(found.body));
      const inferred = await request('POST', search, { queryText: 'hello' });
      assert.equal(inferred.status, 200, JSON.stringify(inferred.body));
      assert.deepEqual(endpoints, [endpoint, endpoint, endpoint]);
    }
  }, { registry: dataRegistry(), fetchImpl: async endpoint => {
    endpoints.push(endpoint);
    return { ok: true, async json() { return { data: [{ embedding: [1, 2, 3] }] }; } };
  } });
});

test('a deleted named connection fails closed before any provider call', async () => {
  let calls = 0;
  await withEmbeddingServer(async (request, { embeddingExecutor }) => {
    await request('POST', collection, { ...config, connectionId: 'first' });
    await request('POST', collection, { ...config, connectionId: 'gone' });
    assert.equal((await request('DELETE', `${collection}/gone`)).status, 200);
    await assert.rejects(embeddingExecutor.embedForWorkspace('shared', 'hello', { tenantId: 'tenant-a', connectionId: 'gone' }), {
      statusCode: 422, code: 'EMBEDDING_CONNECTION_NOT_FOUND',
    });
    assert.equal(calls, 0);
  }, { fetchImpl: async () => { calls++; throw new Error('Unexpected provider call'); } });
});

test('connection writes are catalogued as structural_admin', async () => {
  const { readFile } = await import('node:fs/promises');
  const catalog = JSON.parse(await readFile(new URL('../../deploy/gateway-config/public-route-catalog.json', import.meta.url)));
  for (const [method, path] of [
    ['POST', '/v1/workspaces/{id}/embedding-providers'],
    ['PUT', '/v1/workspaces/{id}/embedding-providers/{connectionId}'],
    ['DELETE', '/v1/workspaces/{id}/embedding-providers/{connectionId}'],
  ]) {
    const entries = catalog.filter(row => row.method === method && row.path === path);
    assert.equal(entries.length, 1, `${method} ${path}`);
    assert.equal(entries[0].privilege_domain, 'structural_admin');
  }
});

test('a stale persisted mapping fails writes and KNN with 422 before any provider call', async () => {
  // Database boundary fixture: a mapping left behind after an out-of-band connection deletion.
  const mappingStore = createEmbeddingMappingStore({ pool: { async query(sql) {
    assert.match(sql, /SELECT \* FROM workspace_embedding_mappings/);
    return { rows: [{ tenant_id: 'tenant-a', workspace_id: 'shared', schema_name: 'public',
      table_name: 'docs', source_column: 'body', target_column: 'embedding', connection_id: 'gone' }] };
  } } });
  let calls = 0;
  await withEmbeddingServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'default' });
    for (const [path, body] of [
      [mappingPath.replace('/embedding-mapping', '/rows'), { body: 'hello' }],
      [mappingPath.replace('/embedding-mapping', '/search'), { queryText: 'hello' }],
    ]) {
      const result = await request('POST', path, body);
      assert.equal(result.status, 422);
      assert.equal(result.body.code, 'EMBEDDING_CONNECTION_NOT_FOUND');
    }
    assert.equal(calls, 0);
  }, { registry: dataRegistry(), mappingStore,
    fetchImpl: async () => { calls++; throw new Error('Unexpected provider call'); },
  });
});
