import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultKvClient, createWorkspaceSecretStore, workspaceSecretPath } from '../../apps/control-plane/vault-secrets.mjs';
import { fakeOpenBao } from '../helpers/fake-openbao-kv.mjs';

function setup() {
  const bao = fakeOpenBao();
  const client = createVaultKvClient({ addr: 'http://synthetic-bao', token: 'synthetic-token', fetchImpl: bao.fetchImpl });
  return { bao, client, store: createWorkspaceSecretStore(client) };
}

for (const fault of [403, 500, new Error('synthetic-value-must-not-leak')]) {
  test(`purge continues after a delete ${typeof fault === 'number' ? fault : 'timeout'} and reports only failed names`, async () => {
    const { bao, store } = setup();
    await store.set('tenant-a', 'ws-a', 'denied', 'synthetic-value-977');
    await store.set('tenant-a', 'ws-a', 'removed', 'synthetic-value-977');
    bao.faults.set(`DELETE:${workspaceSecretPath('tenant-a', 'ws-a', 'denied')}`, fault);
    const result = await store.purgeWorkspace('tenant-a', 'ws-a');
    assert.deepEqual(result, { removed: ['removed'], residual: ['denied'] });
    assert.equal(await store.getValue('tenant-a', 'ws-a', 'removed'), null);
    assert.ok(!JSON.stringify(result).includes('synthetic-value'));
  });
}

test('invalid scope never lists or deletes the shared workspace-secrets root', async () => {
  const { bao, store } = setup();
  for (const id of [undefined, null, '', ' ', '/', '..', '../tenant-b', 'tenant-a/..']) {
    await assert.rejects(() => store.purgeTenant(id), TypeError);
    await assert.rejects(() => store.purgeWorkspace(id, 'ws-a'), TypeError);
    await assert.rejects(() => store.purgeWorkspace('tenant-a', id), TypeError);
  }
  assert.deepEqual(bao.requests, []);
});

test('an unavailable listing is disclosed as an unverified prefix', async () => {
  const { bao, store } = setup();
  bao.faults.set('GET:falcone/workspace-secrets/tenant-a:list', 403);
  assert.deepEqual(await store.purgeTenant('tenant-a'), {
    removed: [], residual: ['falcone/workspace-secrets/tenant-a/'],
  });
});

test('a workspace listing failure does not hide that subtree or block destruction of other subtrees', async () => {
  const { bao, store } = setup();
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-value-977');
  await store.set('tenant-a', 'ws-b', 'probe', 'synthetic-value-977');
  bao.faults.set('GET:falcone/workspace-secrets/tenant-a/ws-a:list', 500);
  const result = await store.purgeTenant('tenant-a');
  assert.deepEqual(result.residual, ['ws-a/']);
  assert.deepEqual(result.removed, ['ws-b/probe']);
});

test('verification failure retains attempted names as unverified, even after metadata deletion', async () => {
  const bao = fakeOpenBao();
  let listings = 0;
  const client = createVaultKvClient({ addr: 'http://synthetic-bao', token: 'synthetic-token', fetchImpl: async (url, init) => {
    if (url.endsWith('?list=true') && ++listings === 2) throw new Error('synthetic-unavailable');
    return bao.fetchImpl(url, init);
  } });
  const store = createWorkspaceSecretStore(client);
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-value-977');
  const result = await store.purgeWorkspace('tenant-a', 'ws-a');
  assert.deepEqual(result.removed, []);
  assert.ok(result.residual.includes('probe'));
});

test('a stalled KV delete is cancelled and reported as residual', async () => {
  const bao = fakeOpenBao();
  let cancelled = false;
  const client = createVaultKvClient({ addr: 'http://synthetic-bao', token: 'synthetic-token', requestTimeoutMs: 5,
    fetchImpl: async (url, init) => {
      if (init.method !== 'DELETE') return bao.fetchImpl(url, init);
      if (!init.signal) throw new Error('missing cancellation');
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
        cancelled = true;
        reject(new Error('synthetic-timeout'));
      }, { once: true }));
    },
  });
  const store = createWorkspaceSecretStore(client);
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-value-977');
  const keepAlive = setInterval(() => {}, 1000);
  try {
    assert.deepEqual(await store.purgeWorkspace('tenant-a', 'ws-a'), { removed: [], residual: ['probe'] });
    assert.equal(cancelled, true);
  } finally { clearInterval(keepAlive); }
});

test('tenant purge recurses, destroys all versions using metadata DELETE, and re-lists', async () => {
  const { bao, client, store } = setup();
  const path = workspaceSecretPath('tenant-a', 'ws-a', 'probe');
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-first-version');
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-second-version');
  await client.writeSecret(`${path}/nested`, { value: 'synthetic-nested-value' });
  await store.set('tenant-b', 'ws-a', 'probe', 'synthetic-other-tenant');
  const result = await store.purgeTenant('tenant-a');
  assert.deepEqual(result, { removed: ['ws-a/probe', 'ws-a/probe/nested'], residual: [] });
  assert.equal(await client.readSecret(path), null);
  assert.equal(await client.readMeta(path), null);
  assert.equal(await client.readMeta(`${path}/nested`), null);
  assert.equal(await store.getValue('tenant-b', 'ws-a', 'probe'), 'synthetic-other-tenant');
  const deletes = bao.requests.filter((r) => r.method === 'DELETE');
  assert.ok(deletes.every((r) => r.kind === 'metadata'));
  assert.equal(deletes.length, 2);
  assert.equal(bao.requests.filter((r) => r.listing && r.key === 'falcone/workspace-secrets/tenant-a').length, 2);
});

test('empty prefixes and already destroyed metadata are idempotent', async () => {
  const { bao, store } = setup();
  assert.deepEqual(await store.purgeTenant('tenant-a'), { removed: [], residual: [] });
  assert.deepEqual(await store.purgeWorkspace('tenant-a', 'ws-a'), { removed: [], residual: [] });
  assert.ok(!bao.requests.some((r) => r.method === 'DELETE'));
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-value');
  await store.purgeWorkspace('tenant-a', 'ws-a');
  assert.deepEqual(await store.purgeWorkspace('tenant-a', 'ws-a'), { removed: [], residual: [] });
});

test('a successful DELETE that leaves metadata behind is caught by verification', async () => {
  const { bao, store } = setup();
  await store.set('tenant-a', 'ws-a', 'probe', 'synthetic-value');
  bao.faults.set(`DELETE:${workspaceSecretPath('tenant-a', 'ws-a', 'probe')}`, 204);
  assert.deepEqual(await store.purgeWorkspace('tenant-a', 'ws-a'), { removed: [], residual: ['probe'] });
});
