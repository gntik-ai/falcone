// fix-byok-secretref-endpoint-confinement (#659) — BYOK provider secret + endpoint confinement.
//
// The vuln: a BYOK (LLM + embedding) provider config persisted a caller-supplied `secretRef.name`
// and `endpoint` VERBATIM, and the resolver did `process.env[secretRef.name]` for ANY name — so a
// tenant_owner could name ANY env var the executor pod holds (HOSTNAME, GATEWAY_SHARED_SECRET,
// PGPASSWORD, MONGO_PASSWORD, FERRETDB_TENANT_URI__*) and have it POSTed as `Authorization: Bearer`
// to an arbitrary (incl. cloud-metadata / loopback / private) endpoint.
//
// This suite encodes BOTH acceptance scenarios for BOTH planes (LLM + embedding), plus unit cover
// for the guard primitives. Public interface only: it drives the executor's config-deploy
// (setProvider/deployProvider — the methods the HTTP PUT routes call) and the request path, with
// an injected env + injected DNS resolver so it is deterministic/offline. No external provider and
// no DB are required (the in-memory store seam backs the executor).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAllowedSecretPrefixes,
  isAllowedSecretName,
  createConfinedSecretResolver,
  assertSecretRefAllowed,
  assertEndpointAllowed,
  DEFAULT_SECRET_PREFIX,
} from '../../apps/control-plane/src/runtime/byok-provider-guard.mjs';
import {
  createLlmExecutor,
  createLlmProviderStore,
  createLlmUsageStore,
  localMockLlmBackend,
} from '../../apps/control-plane/src/runtime/llm-executor.mjs';
import {
  createEmbeddingExecutor,
  createEmbeddingProviderStore,
  localMockEmbeddingBackend,
} from '../../apps/control-plane/src/runtime/embedding-executor.mjs';

// A clearly non-provider placeholder (GitHub push protection rejects sk_live_ etc.).
const FAKE_KEY = 'placeholder-not-a-real-key';

// An injected env that simulates the secrets a real executor pod holds. The ONLY allow-listed
// (BYOK_-prefixed) name is BYOK_LLM_KEY; the rest are exactly the platform secrets the issue
// proves are exfiltratable today.
const POD_ENV = {
  BYOK_LLM_KEY: FAKE_KEY,
  HOSTNAME: 'falcone-cp-executor-74f6464f7-pzssk',
  GATEWAY_SHARED_SECRET: 'gw-shared-secret-value',
  PGPASSWORD: 'pg-password-value',
  PGUSER: 'falcone',
  MONGO_PASSWORD: 'mongo-password-value',
  FERRETDB_TENANT_URI__x: 'mongodb://tenant-x-uri',
};
// The names a malicious tenant_owner would probe — every one MUST be rejected.
const FORBIDDEN_NAMES = ['HOSTNAME', 'GATEWAY_SHARED_SECRET', 'PGPASSWORD', 'MONGO_PASSWORD', 'FERRETDB_TENANT_URI__x', 'PGUSER'];
// Internal/loopback/link-local/metadata/private endpoints (incl. a decimal-encoded link-local).
const BLOCKED_ENDPOINTS = [
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
  'http://127.0.0.1/v1/chat/completions',
  'http://localhost/v1/chat/completions',
  'http://10.0.0.5/v1/chat/completions',
  'http://2852039166/latest', // decimal-encoded 169.254.169.254
];
const PUBLIC_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
// Offline-deterministic DNS resolver: the only DNS host the suite uses (api.openai.com) → public IP.
const PUBLIC_RESOLVER = async () => ['93.184.216.34'];

function makeLlmExecutor() {
  return createLlmExecutor({
    providerStore: createLlmProviderStore(),
    usageStore: createLlmUsageStore(),
    guardEnv: POD_ENV,
    endpointResolver: PUBLIC_RESOLVER,
    backendFactory: () => localMockLlmBackend(),
  });
}

function makeEmbeddingExecutor() {
  return createEmbeddingExecutor({
    store: createEmbeddingProviderStore(),
    guardEnv: POD_ENV,
    endpointResolver: PUBLIC_RESOLVER,
    backendFactory: (config, resolveSecret) => ({
      providerType: 'mock',
      // Assert the embedding backend resolves ONLY an allow-listed secret: a non-allowed name
      // resolves null, so this backend would fail closed before any outbound call.
      async embed() {
        const secret = await resolveSecret();
        if (!secret) throw Object.assign(new Error('secret unresolved'), { statusCode: 500, code: 'EMBEDDING_SECRET_UNRESOLVED' });
        return [0.1, 0.2, 0.3];
      },
    }),
  });
}

const baseLlmConfig = (over = {}) => ({
  tenantId: 'ten_a', providerType: 'openai', endpoint: PUBLIC_ENDPOINT,
  allowedModels: ['gpt-allowed'], defaultModel: 'gpt-allowed', secretRef: { name: 'BYOK_LLM_KEY' }, ...over,
});
const baseEmbConfig = (over = {}) => ({
  tenantId: 'ten_a', providerType: 'openai', model: 'text-embedding-3-small', endpoint: PUBLIC_ENDPOINT,
  secretRef: { name: 'BYOK_LLM_KEY' }, ...over,
});

// ---------------------------------------------------------------------------------------------
// Unit: guard primitives
// ---------------------------------------------------------------------------------------------

test('bbx-byok-unit-01: parseAllowedSecretPrefixes filters empties and falls back to BYOK_', () => {
  assert.deepEqual(parseAllowedSecretPrefixes({}), [DEFAULT_SECRET_PREFIX]);
  assert.deepEqual(parseAllowedSecretPrefixes({ BYOK_SECRET_ALLOWED_PREFIXES: '' }), [DEFAULT_SECRET_PREFIX]);
  assert.deepEqual(parseAllowedSecretPrefixes({ BYOK_SECRET_ALLOWED_PREFIXES: ' , ,  ' }), [DEFAULT_SECRET_PREFIX], 'an all-empty list never yields an empty prefix');
  assert.deepEqual(parseAllowedSecretPrefixes({ BYOK_SECRET_ALLOWED_PREFIXES: 'BYOK_, ACME_KEY_ ' }), ['BYOK_', 'ACME_KEY_']);
});

test('bbx-byok-unit-02: isAllowedSecretName requires a valid identifier that carries a prefix', () => {
  assert.equal(isAllowedSecretName('BYOK_LLM_KEY', ['BYOK_']), true);
  assert.equal(isAllowedSecretName('HOSTNAME', ['BYOK_']), false);
  assert.equal(isAllowedSecretName('', ['BYOK_']), false);
  assert.equal(isAllowedSecretName('BYOK-DASH', ['BYOK_']), false, 'non-identifier rejected');
  assert.equal(isAllowedSecretName('anything', ['']), false, 'an empty prefix NEVER matches every name');
});

test('bbx-byok-unit-03: createConfinedSecretResolver returns the value ONLY for an allow-listed name', async () => {
  const resolve = createConfinedSecretResolver({ env: POD_ENV, prefixes: ['BYOK_'] });
  assert.equal(await resolve({ name: 'BYOK_LLM_KEY' }), FAKE_KEY);
  for (const name of FORBIDDEN_NAMES) {
    assert.equal(await resolve({ name }), null, `confined resolver NEVER reads ${name}`);
  }
  assert.equal(await resolve({ vaultPath: 'secret/x' }), null, 'a name-less ref resolves null');
  assert.equal(await resolve(undefined), null);
});

test('bbx-byok-unit-04: assertSecretRefAllowed throws 400 for a non-allowed name, passes a name-less ref', () => {
  assert.throws(() => assertSecretRefAllowed({ name: 'PGPASSWORD' }, ['BYOK_']), (e) => e.statusCode === 400 && e.code === 'BYOK_SECRET_REF_NOT_ALLOWED');
  assert.doesNotThrow(() => assertSecretRefAllowed({ name: 'BYOK_K' }, ['BYOK_']));
  assert.doesNotThrow(() => assertSecretRefAllowed({ vaultPath: 'p' }, ['BYOK_']), 'a {vaultPath} ref is not an env-var attack');
});

test('bbx-byok-unit-05: assertEndpointAllowed blocks internal targets, allows a public host', async () => {
  for (const ep of BLOCKED_ENDPOINTS) {
    await assert.rejects(() => assertEndpointAllowed(ep, { resolver: PUBLIC_RESOLVER }), (e) => e.code === 'BYOK_ENDPOINT_BLOCKED', `blocked: ${ep}`);
  }
  await assert.rejects(() => assertEndpointAllowed('ftp://example.com/x', { resolver: PUBLIC_RESOLVER }), (e) => e.code === 'BYOK_ENDPOINT_BLOCKED', 'non-http scheme blocked');
  // DNS-rebinding: a public-looking host that resolves to a private IP is blocked.
  await assert.rejects(() => assertEndpointAllowed('https://evil.example.test/x', { resolver: async () => ['10.1.2.3'] }), (e) => e.code === 'BYOK_ENDPOINT_BLOCKED');
  await assert.doesNotReject(() => assertEndpointAllowed(PUBLIC_ENDPOINT, { resolver: PUBLIC_RESOLVER }));
});

test('bbx-byok-unit-06: BYOK_ENDPOINT_ALLOWED_HOSTS restricts to a suffix AND still applies the blocklist', async () => {
  const env = { BYOK_ENDPOINT_ALLOWED_HOSTS: 'openai.com' };
  await assert.doesNotReject(() => assertEndpointAllowed('https://api.openai.com/v1', { env, resolver: PUBLIC_RESOLVER }));
  await assert.rejects(() => assertEndpointAllowed('https://api.other.test/v1', { env, resolver: PUBLIC_RESOLVER }), (e) => e.code === 'BYOK_ENDPOINT_BLOCKED', 'host not in allow-list');
  // Even an allow-listed host is still blocked when it resolves to a private address.
  await assert.rejects(() => assertEndpointAllowed('https://internal.openai.com/v1', { env, resolver: async () => ['127.0.0.1'] }), (e) => e.code === 'BYOK_ENDPOINT_BLOCKED');
});

// ---------------------------------------------------------------------------------------------
// Scenario 1 (non-provisioned secret name) — LLM + embedding planes
// ---------------------------------------------------------------------------------------------

test('bbx-byok-01: LLM setProvider with a non-allowed secretRef name is rejected 400 and persists NO row', async () => {
  const llm = makeLlmExecutor();
  for (const name of FORBIDDEN_NAMES) {
    await assert.rejects(
      () => llm.setProvider('ws1', baseLlmConfig({ secretRef: { name } })),
      (e) => e.statusCode === 400 && e.code === 'BYOK_SECRET_REF_NOT_ALLOWED',
      `rejected: ${name}`,
    );
    assert.equal(await llm.getProvider('ws1', 'ten_a'), null, `no row persisted for ${name}`);
  }
});

test('bbx-byok-02: embedding deployProvider with a non-allowed secretRef name is rejected 400 and persists NO row', async () => {
  const emb = makeEmbeddingExecutor();
  for (const name of FORBIDDEN_NAMES) {
    await assert.rejects(
      () => emb.deployProvider('ws1', baseEmbConfig({ secretRef: { name } })),
      (e) => e.statusCode === 400 && e.code === 'BYOK_SECRET_REF_NOT_ALLOWED',
      `rejected: ${name}`,
    );
    assert.equal(await emb.store.getProvider('ws1', 'ten_a'), null, `no row persisted for ${name}`);
  }
});

test('bbx-byok-03: an allow-listed (BYOK_) secretRef name is accepted on both planes and a completion succeeds', async () => {
  const llm = makeLlmExecutor();
  const okLlm = await llm.setProvider('ws1', baseLlmConfig());
  assert.deepEqual(okLlm.secretRef, { name: 'BYOK_LLM_KEY' });
  const comp = await llm.complete('ws1', { tenantId: 'ten_a', model: 'gpt-allowed', messages: [{ role: 'user', content: 'ping' }] });
  assert.match(comp.content, /ping/, 'completion runs with the allow-listed key');

  const emb = makeEmbeddingExecutor();
  const okEmb = await emb.deployProvider('ws1', baseEmbConfig());
  assert.deepEqual(okEmb.secretRef, { name: 'BYOK_LLM_KEY' });
  const vec = await emb.embedForWorkspace('ws1', 'q', { tenantId: 'ten_a' });
  assert.deepEqual(vec, [0.1, 0.2, 0.3]);
});

test('bbx-byok-04: a completion NEVER resolves a non-allowed env var (malicious pre-existing row fails closed)', async () => {
  const llm = makeLlmExecutor();
  // Bypass the deploy-time guard by writing the malicious row straight to the store (simulating a
  // row persisted BEFORE this guard shipped). The request path must STILL fail closed and never
  // resolve PGPASSWORD / HOSTNAME / etc.
  for (const name of FORBIDDEN_NAMES) {
    await llm.providerStore.deployProvider('ws_evil', baseLlmConfig({ tenantId: 'ten_a', secretRef: { name } }));
    await assert.rejects(
      () => llm.complete('ws_evil', { tenantId: 'ten_a', model: 'gpt-allowed', messages: [{ role: 'user', content: 'x' }] }),
      (e) => e.code === 'LLM_PROVIDER_SECRET_UNRESOLVED',
      `request fails closed for ${name}`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Scenario 2 (internal endpoint) — LLM + embedding planes
// ---------------------------------------------------------------------------------------------

test('bbx-byok-05: LLM setProvider with an internal/metadata/private endpoint is rejected 400 and persists NO row', async () => {
  const llm = makeLlmExecutor();
  for (const endpoint of BLOCKED_ENDPOINTS) {
    await assert.rejects(
      () => llm.setProvider('ws1', baseLlmConfig({ endpoint })),
      (e) => e.statusCode === 400 && e.code === 'BYOK_ENDPOINT_BLOCKED',
      `blocked: ${endpoint}`,
    );
    assert.equal(await llm.getProvider('ws1', 'ten_a'), null, `no row persisted for ${endpoint}`);
  }
});

test('bbx-byok-06: embedding deployProvider with an internal/metadata/private endpoint is rejected 400 and persists NO row', async () => {
  const emb = makeEmbeddingExecutor();
  for (const endpoint of BLOCKED_ENDPOINTS) {
    await assert.rejects(
      () => emb.deployProvider('ws1', baseEmbConfig({ endpoint })),
      (e) => e.statusCode === 400 && e.code === 'BYOK_ENDPOINT_BLOCKED',
      `blocked: ${endpoint}`,
    );
    assert.equal(await emb.store.getProvider('ws1', 'ten_a'), null, `no row persisted for ${endpoint}`);
  }
});

test('bbx-byok-07: a request against a malicious pre-existing internal-endpoint row fails closed (no request sent)', async () => {
  const llm = makeLlmExecutor();
  // Malicious endpoint row written straight to the store (pre-guard). The request path re-validates
  // the endpoint just before dialing, so the outbound call is never made.
  await llm.providerStore.deployProvider('ws_evil_ep', baseLlmConfig({ tenantId: 'ten_a', endpoint: 'http://169.254.169.254/latest', secretRef: { name: 'BYOK_LLM_KEY' } }));
  await assert.rejects(
    () => llm.complete('ws_evil_ep', { tenantId: 'ten_a', model: 'gpt-allowed', messages: [{ role: 'user', content: 'x' }] }),
    (e) => e.code === 'BYOK_ENDPOINT_BLOCKED',
    'request to a metadata endpoint fails closed',
  );
});

test('bbx-byok-08: a public provider endpoint is accepted on both planes', async () => {
  const llm = makeLlmExecutor();
  await assert.doesNotReject(() => llm.setProvider('ws_pub', baseLlmConfig({ tenantId: 'ten_pub' })));
  const emb = makeEmbeddingExecutor();
  await assert.doesNotReject(() => emb.deployProvider('ws_pub', baseEmbConfig({ tenantId: 'ten_pub' })));
});
