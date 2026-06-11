// Black-box test suite for change add-vector-search — pluggable embedding-provider
// backend + per-workspace provider store. Drives the PUBLIC runtime surface only:
//   apps/control-plane/src/runtime/embedding-executor.mjs
//
// Tests: bbx-vec-emb-01 .. bbx-vec-emb-09
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  localMockEmbeddingBackend,
  httpEmbeddingBackend,
  createEmbeddingProviderStore,
} from '../../apps/control-plane/src/runtime/embedding-executor.mjs';

// A clearly non-provider placeholder (GitHub push protection rejects sk_live_ etc.).
const FAKE_SECRET = 'placeholder-not-a-real-key';

// bbx-vec-emb-01: localMockEmbeddingBackend returns a deterministic vector of N dims.
test('bbx-vec-emb-01: mock backend returns a deterministic vector of the requested dimension', async () => {
  const backend = localMockEmbeddingBackend({ dimension: 4 });
  const a = await backend.embed('hello');
  const b = await backend.embed('hello');
  assert.equal(a.length, 4);
  assert.deepEqual(a, b, 'deterministic for the same text');
  assert.ok(a.every((n) => typeof n === 'number'));
});

// bbx-vec-emb-02: mock backend dimension is configurable.
test('bbx-vec-emb-02: mock backend honours a different dimension', async () => {
  const backend = localMockEmbeddingBackend({ dimension: 1536 });
  const v = await backend.embed('semantic query');
  assert.equal(v.length, 1536);
});

// bbx-vec-emb-03: httpEmbeddingBackend resolves the secret at request time and posts to the provider.
test('bbx-vec-emb-03: http backend calls the provider with the resolved secret', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
      },
    };
  };
  const backend = httpEmbeddingBackend({
    providerType: 'openai',
    model: 'text-embedding-3-small',
    endpoint: 'https://embeddings.example.test/v1/embeddings',
    resolveSecret: async () => FAKE_SECRET,
    fetchImpl: fakeFetch,
  });
  const v = await backend.embed('hi');
  assert.deepEqual(v, [0.1, 0.2, 0.3]);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].init.headers.Authorization ?? calls[0].init.headers.authorization), new RegExp(FAKE_SECRET));
});

// bbx-vec-emb-04: http backend surfaces a configuration error when the secret cannot resolve.
test('bbx-vec-emb-04: http backend fails closed when the secret path cannot be resolved', async () => {
  const backend = httpEmbeddingBackend({
    providerType: 'openai',
    model: 'm',
    endpoint: 'https://embeddings.example.test/v1/embeddings',
    resolveSecret: async () => undefined, // Vault path missing
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  await assert.rejects(() => backend.embed('hi'), (e) => e.statusCode === 500 || /secret|configuration/i.test(e.message));
});

// bbx-vec-emb-05: provider store is per-workspace; deploy/get/remove round-trips.
test('bbx-vec-emb-05: provider store is workspace-scoped (deploy/get/remove)', async () => {
  const store = createEmbeddingProviderStore();
  await store.deployProvider('ws_a', { providerType: 'openai', model: 'text-embedding-3-small', secretRef: { vaultPath: 'secret/ws-a/openai-key' } });
  const got = await store.getProvider('ws_a');
  assert.equal(got.providerType, 'openai');
  assert.equal(got.model, 'text-embedding-3-small');
  // The resolved secret value is NEVER stored — only the secretRef.
  assert.ok(!('apiKey' in got) && !('secret' in got), 'no plaintext secret persisted');
  assert.ok(got.secretRef?.vaultPath, 'secretRef persisted');

  await store.removeProvider('ws_a');
  assert.equal(await store.getProvider('ws_a'), null);
});

// bbx-vec-emb-06: provider from workspace A is not visible to workspace B.
test('bbx-vec-emb-06: provider is not shared across workspaces', async () => {
  const store = createEmbeddingProviderStore();
  await store.deployProvider('ws_a', { providerType: 'openai', model: 'm', secretRef: { vaultPath: 'secret/ws-a/k' } });
  assert.equal(await store.getProvider('ws_b'), null, 'workspace B has no provider');
});

// bbx-vec-emb-07: replacing the provider returns a migration warning.
test('bbx-vec-emb-07: replacing a provider returns a re-index warning', async () => {
  const store = createEmbeddingProviderStore();
  await store.deployProvider('ws_a', { providerType: 'openai', model: 'text-embedding-3-small', secretRef: { vaultPath: 'secret/ws-a/k' } });
  const res = await store.deployProvider('ws_a', { providerType: 'cohere', model: 'embed-english-v3', secretRef: { vaultPath: 'secret/ws-a/k2' } });
  assert.ok(res.warning, 'replacement surfaces a warning');
  assert.match(res.warning, /re-?index|existing|previous/i);
});

// bbx-vec-emb-08: first-time deploy does NOT warn.
test('bbx-vec-emb-08: first provider deploy has no warning', async () => {
  const store = createEmbeddingProviderStore();
  const res = await store.deployProvider('ws_a', { providerType: 'openai', model: 'm', secretRef: { vaultPath: 'secret/ws-a/k' } });
  assert.ok(!res.warning, 'no warning on first deploy');
});

// bbx-vec-emb-09: http backend maps a provider error to a client error.
test('bbx-vec-emb-09: http backend maps a non-2xx provider response to an error', async () => {
  const backend = httpEmbeddingBackend({
    providerType: 'openai',
    model: 'm',
    endpoint: 'https://embeddings.example.test/v1/embeddings',
    resolveSecret: async () => FAKE_SECRET,
    fetchImpl: async () => ({ ok: false, status: 401, async json() { return { error: 'unauthorized' }; } }),
  });
  await assert.rejects(() => backend.embed('hi'), (e) => /provider|embedding|401/i.test(e.message));
});
