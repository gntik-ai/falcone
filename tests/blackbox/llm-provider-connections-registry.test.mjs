import test from 'node:test';
import assert from 'node:assert/strict';
import { withLlmServer, config, collection } from './helpers/llm-connections.mjs';

test('two named connections coexist and are listed in connectionId order', async () => {
  await withLlmServer(async request => {
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
  await withLlmServer(async request => {
    await request('POST', collection, { ...config, connectionId: 'first' });
    await request('POST', collection, { ...config, connectionId: 'second' });
    const moved = await request('PUT', `${collection}/second`, { ...config, isDefault: true, displayName: 'Second' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.displayName, 'Second');
    assert.deepEqual((await request('GET')).body.items.filter(r => r.isDefault).map(r => r.connectionId), ['second']);
    const denied = await request('PUT', `${collection}/second`, { ...config, isDefault: false });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'LLM_DEFAULT_REQUIRED');
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
  await withLlmServer(async request => {
    for (const id of ['Bad', '-bad', 'a'.repeat(64), 'bad_id', '']) {
      const r = await request('POST', collection, { ...config, connectionId: id });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'INVALID_CONNECTION_ID');
    }
    const tooLong = await request('POST', collection, { ...config, connectionId: 'long', displayName: 'x'.repeat(129) });
    assert.equal(tooLong.status, 400);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await request(method, `${collection}/missing`, method === 'PUT' ? config : undefined);
      assert.equal(r.status, 404);
      assert.equal(r.body.code, 'LLM_CONNECTION_NOT_FOUND');
    }
    for (let i = 0; i < 32; i++) assert.equal((await request('POST', collection, { ...config, connectionId: `conn-${i}` })).status, 201);
    const duplicate = await request('POST', collection, { ...config, connectionId: 'conn-0' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'LLM_CONNECTION_EXISTS');
    const before = (await request('GET')).body;
    const overflow = await request('POST', collection, { ...config, connectionId: 'overflow', isDefault: true });
    assert.equal(overflow.status, 409);
    assert.equal(overflow.body.code, 'LLM_CONNECTION_LIMIT_REACHED');
    assert.deepEqual((await request('GET')).body, before);
    assert.equal((await request('PUT', `${collection}/conn-1`, { ...config, isDefault: true })).status, 200);
  });
});

test('rejected secret references and endpoints write nothing; plaintext keys are stripped', async () => {
  await withLlmServer(async request => {
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
  await withLlmServer(async request => {
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
