import test from 'node:test';
import assert from 'node:assert/strict';

const { createSecretRotationDependencies } = await import('../../apps/control-plane/secret-rotation-deps.mjs');

test('rotation dependencies use KV v2 envelopes, configured mount, token and soft delete', async () => {
  assert.equal(createSecretRotationDependencies({ env: {} }).vaultClient, null);
  assert.equal(createSecretRotationDependencies({ env: { BAO_ADDR: 'http://bao' } }).vaultClient, null);
  const requests = [];
  const deps = createSecretRotationDependencies({ env: { BAO_ADDR: 'http://bao/', BAO_TOKEN: 'fixture-token', BAO_KV_MOUNT: 'secret' },
    fetchImpl: async (url, init) => { requests.push({ url, ...init }); return Response.json({ data: { version: 7 } }); } });
  assert.deepEqual(await deps.vaultClient.writeSecret('platform/app-password', { data: { value: 'fixture-value' } }), { version: 7 });
  await deps.vaultClient.deleteSecretVersion('platform/app-password', 1);
  assert.deepEqual(requests.map(r => [r.method, r.url, JSON.parse(r.body), r.headers['x-vault-token']]), [
    ['POST', 'http://bao/v1/secret/data/platform/app-password', { data: { value: 'fixture-value' } }, 'fixture-token'],
    ['POST', 'http://bao/v1/secret/delete/platform/app-password', { versions: [1] }, 'fixture-token']
  ]);
  const failing = createSecretRotationDependencies({ env: { VAULT_ADDR: 'http://bao', VAULT_TOKEN: 'fixture-token' }, fetchImpl: async () => new Response('', { status: 500 }) });
  await assert.rejects(failing.vaultClient.writeSecret('platform/app-password', { data: { value: 'fixture-value' } }));
  await assert.rejects(failing.vaultClient.deleteSecretVersion('platform/app-password', 1));
});

test('Kafka records and ESO merge patches use public wire contracts without waiting for completion', async () => {
  const sent = [], patches = [];
  const deps = createSecretRotationDependencies({ env: {},
    getProducer: async () => ({ send(record) { sent.push(record); return new Promise(() => {}); } }),
    getKubernetesApi: async () => ({ patchExternalSecret(...args) { patches.push(args); return new Promise(() => {}); } }),
  });
  await deps.publishEvent('console.secrets.rotation.initiated', { secretPath: 'platform/app-password', vaultVersion: 7 });
  await deps.publishEvent('console.secrets.rotation.revoked', {});
  await deps.triggerEsoRefresh('app-password', 'apps');
  await deps.triggerEsoRefresh(null, 'apps');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [
    { topic: 'console.secrets.rotation.initiated', messages: [{ key: 'platform/app-password', value: '{"secretPath":"platform/app-password","vaultVersion":7}' }] },
    { topic: 'console.secrets.rotation.revoked', messages: [{ key: null, value: '{}' }] }
  ]);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].slice(0, 2), ['app-password', 'apps']);
  assert.match(patches[0][2].metadata.annotations['force-sync'], /^\d{4}-\d\d-\d\dT/);
});

test('side effect failures log only safe operation fields and never reject', async () => {
  const logs = [];
  const deps = createSecretRotationDependencies({ env: {}, logger: { error: record => logs.push(record) },
    getProducer: async () => { throw Object.assign(new Error('private-value private-justification'), { code: 'KAFKA_DOWN' }); },
    getKubernetesApi: async () => { throw Object.assign(new Error('private-value'), { code: 'KUBE_DOWN' }); },
  });
  await deps.publishEvent('console.secrets.rotation.revoked', { newValue: 'private-value', justification: 'private-justification' });
  await deps.triggerEsoRefresh('app-password', 'apps');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(logs, [
    { event: 'secret_rotation_side_effect_failed', op: 'publishEvent', topic: 'console.secrets.rotation.revoked', code: 'KAFKA_DOWN' },
    { event: 'secret_rotation_side_effect_failed', op: 'triggerEsoRefresh', externalSecret: 'app-password', namespace: 'apps', code: 'KUBE_DOWN' }
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /private-/);
});

test('ESO requests use the namespaced v1beta1 merge-patch endpoint', async () => {
  const { patchExternalSecret } = await import('../../apps/control-plane/kubernetes-api.mjs');
  const calls = [];
  const request = async (...args) => { calls.push(args); return { status: 200, body: {} }; };
  const patch = { metadata: { annotations: { 'force-sync': '2026-10-16T00:00:00.000Z' } } };
  await patchExternalSecret(request, 'app-password', 'apps', patch);
  assert.deepEqual(calls, [['PATCH', '/apis/external-secrets.io/v1beta1/namespaces/apps/externalsecrets/app-password', patch, 'application/merge-patch+json']]);
  await assert.rejects(patchExternalSecret(async () => ({ status: 404 }), 'missing', 'apps', patch), { code: 'KUBE_HTTP_404' });
});

test('constructing rotation dependencies performs no Kubernetes login before validation', async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const directory = mkdtempSync('/tmp/rotation-auth-fixture-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(`${directory}/jwt`, 'synthetic-service-account-jwt');
  const requests = [];
  const deps = createSecretRotationDependencies({ env: { BAO_ADDR: 'http://bao', BAO_KUBERNETES_AUTH_ROLE: 'fixture-role', BAO_SERVICEACCOUNT_JWT_PATH: `${directory}/jwt` }, fetchImpl: async (url, init) => {
    requests.push({ url, method: init.method });
    return Response.json(url.endsWith('/login') ? { auth: { client_token: 'synthetic-token', lease_duration: 3600 } } : { data: { version: 7 } });
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, []);
  await deps.vaultClient.writeSecret('platform/app-password', { data: { value: 'fixture-value' } });
  await deps.vaultClient.deleteSecretVersion('platform/app-password', 1);
  assert.deepEqual(requests.map(r => r.url), ['http://bao/v1/auth/kubernetes/login', 'http://bao/v1/secret/data/platform/app-password', 'http://bao/v1/secret/delete/platform/app-password']);
});
