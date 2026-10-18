import test from 'node:test';
import assert from 'node:assert/strict';
import { withEmbeddingServer, config, collection, singular } from './helpers/embedding-connections.mjs';

test('singular routes retain their legacy shape and operate only on the current default', async () => {
  await withEmbeddingServer(async request => {
    assert.equal((await request('GET', singular)).body.code, 'EMBEDDING_PROVIDER_NOT_FOUND');
    assert.equal((await request('PUT', singular, config)).body.connectionId, 'default');
    await request('POST', collection, { ...config, connectionId: 'named', isDefault: true });
    const updated = await request('PUT', singular, { ...config, providerType: 'anthropic' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.connectionId, 'named');
    assert.match(updated.body.warning, /re-indexing/);
    const get = await request('GET', singular);
    assert.deepEqual(Object.keys(get.body).sort(), ['tenantId', 'workspaceId', 'connectionId', 'providerType', 'endpoint', 'model', 'dimension', 'secretRef', 'updatedAt'].sort());
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

test('singular PUT cannot insert a 33rd connection and makes no changes', async () => {
  await withEmbeddingServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'temporary' });
    await request('POST', collection, { ...config, connectionId: 'conn-0' });
    await request('DELETE', `${collection}/temporary`);
    for (let i = 1; i < 32; i++) await request('POST', collection, { ...config, connectionId: `conn-${i}` });
    const before = (await request('GET')).body;
    const result = await request('PUT', singular, config);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'EMBEDDING_CONNECTION_LIMIT_REACHED');
    assert.deepEqual((await request('GET')).body, before);
  });
});
