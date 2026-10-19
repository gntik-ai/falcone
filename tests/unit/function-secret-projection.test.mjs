import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFunctionKsvcManifest } from '../../apps/control-plane/function-executor.mjs';
import { invocationFixture, installInvocationFixture } from '../helpers/function-invocation-fixture.mjs';
const scope = { tenantId: 'tenant-a', workspaceId: 'ws-a', functionResourceId: 'fn-a' };
test('workspace secret values never enter a workload manifest', (t) => {
  installInvocationFixture(t, invocationFixture());
  const manifest = buildFunctionKsvcManifest('fn-example', 'return 1', {
    ...scope, secretEnv: [{ name: 'API_KEY', value: 'synthetic-marker-970' }],
  });
  assert.equal(JSON.stringify(manifest).includes('synthetic-marker-970'), false);
  assert.deepEqual(manifest.spec.template.spec.containers[0].env[0], {
    name: 'API_KEY', valueFrom: { secretKeyRef: { name: 'fn-example-secrets', key: 'API_KEY', optional: false } },
  });
});

import { cluster } from '../helpers/function-kubernetes-fixture.mjs';
const { deployKnativeService, NS, buildFunctionOwnershipLabels } = await import('../../apps/control-plane/function-executor.mjs');
const secretPath = `/api/v1/namespaces/${NS}/secrets/fn-example-secrets`;
const servicePath = `/apis/serving.knative.dev/v1/namespaces/${NS}/services/fn-example`;

test('deploy projects only declared values into an owned Secret and binds it to the Service UID', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster({ allowBlockingOwnerReferences: false });
  await deployKnativeService('fn-example', 'return 1', { ...scope, request: api.request, secretEnv: [{ name: 'API_KEY', value: 'marker' }] });
  const secret = api.objects.get(secretPath);
  assert.deepEqual(secret?.data, { API_KEY: Buffer.from('marker').toString('base64') });
  assert.deepEqual(secret.metadata.labels, buildFunctionOwnershipLabels(scope));
  assert.deepEqual(secret.metadata.ownerReferences, [{ apiVersion: 'serving.knative.dev/v1', kind: 'Service', name: 'fn-example', uid: api.objects.get(servicePath).metadata.uid, controller: true }]);
  assert.equal(JSON.stringify(api.objects.get(servicePath)).includes('marker'), false);
});

test('redeploy removes an older projection blocking owner reference', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const deploy = () => deployKnativeService('fn-example', 'return 1', { ...scope, request: api.request,
    secretEnv: [{ name: 'API_KEY', value: 'marker' }] });
  await deploy();
  api.objects.get(secretPath).metadata.ownerReferences[0].blockOwnerDeletion = true;
  await deploy();
  assert.notEqual(api.objects.get(secretPath).metadata.ownerReferences[0].blockOwnerDeletion, true);
});

test('Secret write errors are redacted and stop before any Service write', async (t) => {
  installInvocationFixture(t, invocationFixture());
  for (const statusCode of [403, 409, 503]) {
    const api = cluster();
    const request = async (method, path, body, options) => {
      if (path.includes('/secrets')) throw Object.assign(new Error('synthetic-marker-970'), { statusCode });
      return api.request(method, path, body, options);
    };
    await assert.rejects(deployKnativeService('fn-example', 'return 1', { ...scope, request, secretEnv: [{ name: 'KEY', value: 'synthetic-marker-970' }] }), (e) => !e.message.includes('synthetic-marker-970'));
    assert.equal(api.calls.length, 0);
  }
});
test('failed Service creation rolls back the new Secret', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const request = async (method, path, body, options) => {
    if (method === 'POST' && path.endsWith('/services')) throw Object.assign(new Error('failed'), { statusCode: 503 });
    return api.request(method, path, body, options);
  };
  await assert.rejects(deployKnativeService('fn-example', 'return 1', { ...scope, request, secretEnv: [{ name: 'KEY', value: 'marker' }] }));
  assert.equal(api.objects.has(secretPath), false);
});
test('redeploy fully replaces Secret keys, and an empty declaration deletes the projection', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster({ deferForegroundDeletion: true });
  const deploy = (secretEnv) => deployKnativeService('fn-example', 'return 1', { ...scope, request: api.request, secretEnv });
  await deploy([{ name: 'KEEP', value: 'one' }, { name: 'DROP', value: 'two' }]);
  await deploy([{ name: 'KEEP', value: 'three' }]);
  assert.deepEqual(api.objects.get(secretPath).data, { KEEP: 'dGhyZWU=' });
  await deploy([]);
  assert.equal(api.objects.has(secretPath), false);
});
test('neither a foreign Secret nor a foreign Service is adopted on conflict', async (t) => {
  installInvocationFixture(t, invocationFixture());
  for (const foreignPath of [secretPath, servicePath]) {
    const api = cluster();
    const foreign = { metadata: { name: foreignPath.split('/').at(-1), uid: 'foreign', resourceVersion: '1', labels: buildFunctionOwnershipLabels({ ...scope, tenantId: 'tenant-b' }) } };
    api.objects.set(foreignPath, foreign);
    await assert.rejects(deployKnativeService('fn-example', 'return 1', { ...scope, request: api.request, secretEnv: [{ name: 'KEY', value: 'marker' }] }));
    assert.deepEqual(api.objects.get(foreignPath), foreign);
  }
});

test('legacy remediation defaults to a value-free dry run and apply prunes inline Revisions', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const { remediateFunctionSecrets } = await import('../../apps/control-plane/function-executor.mjs');
  assert.equal(typeof remediateFunctionSecrets, 'function');
  const api = cluster();
  const labels = buildFunctionOwnershipLabels(scope);
  api.objects.set(servicePath, { metadata: { name: 'fn-example', uid: 'svc-legacy', resourceVersion: '1', labels }, spec: { template: { spec: { containers: [{ env: [{ name: 'API_KEY', value: 'old-marker' }] }] } } } });
  const revisionPath = `/apis/serving.knative.dev/v1/namespaces/${NS}/revisions/rev-old`;
  api.objects.set(revisionPath, { metadata: { name: 'rev-old', uid: 'rev-legacy', resourceVersion: '2', labels, ownerReferences: [{ uid: 'svc-legacy' }] }, spec: { containers: [{ env: [{ name: 'API_KEY', value: 'old-marker' }] }] } });
  const report = await remediateFunctionSecrets('fn-example', 'return 1', { ...scope, request: api.request });
  assert.deepEqual(report.affected.map((r) => r.kind).sort(), ['Revision', 'Service']);
  assert.equal(JSON.stringify(report).includes('old-marker'), false);
  assert.equal(api.calls.every((c) => c.method === 'GET'), true);
  const applied = await remediateFunctionSecrets('fn-example', 'return 1', { ...scope, request: api.request, dryRun: false, secretEnv: [{ name: 'API_KEY', value: 'new-marker' }] });
  assert.equal(applied.pending.length, 0);
  assert.equal(api.objects.has(revisionPath), false);
  assert.equal(JSON.stringify(api.objects.get(servicePath)).includes('marker'), false);
});

test('namespace remediation discovery finds inline Functions without enumerating resource IDs', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const { runFunctionSecretRemediation } = await import('../../apps/control-plane/remediate-function-secrets.mjs');
  const api = cluster({ knative: true });
  for (const [name, tenantId, resourceId] of [
    ['fn-first', 'tenant-a', 'fn-a'], ['fn-second', 'tenant-b', 'fn-b'],
  ]) {
    const manifest = buildFunctionKsvcManifest(name, 'return 1', { ...scope, tenantId, functionResourceId: resourceId });
    manifest.spec.template.spec.containers[0].env.push({ name: 'API_KEY', value: 'discovery-marker' });
    await api.request('POST', servicePath.slice(0, servicePath.lastIndexOf('/')), manifest);
  }
  await deployKnativeService('fn-clean', 'return 1', { ...scope, request: api.request });
  // Unlabelled workloads are outside this Function ownership boundary.
  const foreign = buildFunctionKsvcManifest('other-service', 'return 1', scope);
  foreign.metadata.labels = {};
  foreign.spec.template.spec.containers[0].env.push({ name: 'API_KEY', value: 'foreign-marker' });
  await api.request('POST', servicePath.slice(0, servicePath.lastIndexOf('/')), foreign);
  const before = structuredClone([...api.objects.entries()]);
  const start = api.calls.length;
  let pages = 0;
  const request = async (method, path, body, options) => {
    const result = await api.request(method, path, body, options);
    if (path.split('?')[0].endsWith('/services')) {
      const next = new URLSearchParams(path.split('?')[1]).get('continue');
      pages++;
      return next ? { items: result.items.slice(1) }
        : { items: result.items.slice(0, 1), metadata: { continue: 'page-2' } };
    }
    return result;
  };
  const report = await runFunctionSecretRemediation({ discover: true, request,
    pool: { query: () => assert.fail('discovery must not require database access') },
    vault: { resolveEnv: () => assert.fail('discovery must not resolve values') } });
  assert.equal(pages, 2);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.functions.map(({ tenantId, resourceId, name }) => ({ tenantId, resourceId, name })), [
    { tenantId: 'tenant-a', resourceId: 'fn-a', name: 'fn-first' },
    { tenantId: 'tenant-b', resourceId: 'fn-b', name: 'fn-second' },
  ]);
  for (const fn of report.functions) {
    assert.deepEqual(fn.affected.map(({ kind }) => kind), ['Service', 'Configuration', 'Revision', 'Deployment', 'ReplicaSet']);
    for (const item of fn.affected) assert.deepEqual(item.envNames, ['API_KEY']);
  }
  assert.equal(JSON.stringify(report).includes('marker'), false);
  assert.equal(api.calls.slice(start).every(({ method }) => method === 'GET'), true);
  assert.deepEqual([...api.objects.entries()], before);
  for (const options of [{ apply: true }, { refs: [] }, { resourceId: 'fn-a' },
    { tenantId: 'tenant-a' }, { workspaceId: 'ws-a' }]) {
    assert.throws(() => runFunctionSecretRemediation({ discover: true, request, ...options }), /read-only/);
  }
});

test('operator remediation distinguishes legacy user env from Knative-injected env', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const { runFunctionSecretRemediation } = await import('../../apps/control-plane/remediate-function-secrets.mjs');
  for (const envName of ['API_KEY', 'PORT', 'K_REVISION', 'K_CONFIGURATION']) {
    const api = cluster({ knative: true });
    const manifest = buildFunctionKsvcManifest('fn-example', 'return 1', scope);
    manifest.spec.template.spec.containers[0].env.push({ name: envName, value: 'legacy-marker' });
    await api.request('POST', servicePath.slice(0, servicePath.lastIndexOf('/')), manifest);
    const row = { resource_id: scope.functionResourceId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
      ksvc_name: 'fn-example', source_code: 'return 1', secret_refs: [{ name: 'api-key', env: envName }] };
    const options = { ...scope, pool: { query: async () => ({ rows: [row] }) }, resourceId: row.resource_id,
      request: api.request, vault: { resolveEnv: async () => [{ name: envName, value: 'new-marker' }] } };
    const report = await runFunctionSecretRemediation(options);
    assert.deepEqual(report.affected.map((item) => item.kind), ['Service', 'Configuration', 'Revision', 'Deployment', 'ReplicaSet']);
    for (const item of report.affected) assert.deepEqual(item.envNames, [envName]);
    const result = await runFunctionSecretRemediation({ ...options, apply: true });
    assert.equal(result.code, undefined);
    assert.deepEqual(result.pending, []);
    assert.equal(JSON.stringify([...api.objects.values()]).includes('legacy-marker'), false);
    assert.deepEqual((await runFunctionSecretRemediation(options)).affected, []);
  }
});

test('remediation follows UID ancestry through all five kinds and retains unrelated workloads', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const { remediateFunctionSecrets } = await import('../../apps/control-plane/function-executor.mjs');
  const api = cluster();
  const labels = buildFunctionOwnershipLabels(scope);
  const template = { spec: { containers: [{ env: [{ name: 'KEY', value: 'legacy-marker' }] }] } };
  api.objects.set(servicePath, { metadata: { name: 'fn-example', uid: 'svc-old', resourceVersion: '1', labels }, spec: { template } });
  const configPath = `/apis/serving.knative.dev/v1/namespaces/${NS}/configurations/fn-example`;
  const revPath = `/apis/serving.knative.dev/v1/namespaces/${NS}/revisions/rev-old`;
  const deployPath = `/apis/apps/v1/namespaces/${NS}/deployments/deploy-old`;
  const rsPath = `/apis/apps/v1/namespaces/${NS}/replicasets/rs-old`;
  const legacy = [
    [configPath, 'config-old', 'svc-old', { template }],
    [revPath, 'rev-old', 'config-old', template.spec],
    [deployPath, 'deploy-old', 'rev-old', { template }],
    [rsPath, 'rs-old', 'deploy-old', { template }],
  ];
  for (const [path, uid, parent, spec] of legacy) api.objects.set(path, { metadata: { name: path.split('/').at(-1), uid, resourceVersion: '2', ownerReferences: [{ uid: parent }] }, spec });
  const foreignPath = `/apis/serving.knative.dev/v1/namespaces/${NS}/revisions/foreign`;
  const foreign = { metadata: { name: 'foreign', uid: 'foreign', resourceVersion: '1', ownerReferences: [{ uid: 'other-service' }] }, spec: template.spec };
  api.objects.set(foreignPath, foreign);
  const request = async (method, path, body, options) => {
    const result = await api.request(method, path, body, options);
    // The external Knative controller reconciles Configuration; Kubernetes foreground GC
    // removes descendants of a deleted Revision. Neither is an internal Falcone collaborator.
    if (method === 'PATCH' && path === servicePath) api.objects.get(configPath).spec = { template: structuredClone(body.spec.template) };
    if (method === 'DELETE' && path === revPath) { api.objects.delete(deployPath); api.objects.delete(rsPath); }
    return result;
  };
  const report = await remediateFunctionSecrets('fn-example', 'return 1', { ...scope, request });
  assert.deepEqual(report.affected.map((o) => o.kind), ['Service', 'Configuration', 'Revision', 'Deployment', 'ReplicaSet']);
  const result = await remediateFunctionSecrets('fn-example', 'return 1', { ...scope, request, dryRun: false, secretEnv: [{ name: 'KEY', value: 'rotated-marker' }] });
  assert.deepEqual(result.pending, []);
  assert.equal(JSON.stringify([...api.objects.entries()].filter(([p]) => p !== foreignPath)).includes('legacy-marker'), false);
  assert.deepEqual(api.objects.get(foreignPath), foreign);
});

test('remediation reports foreground Revision descendants until garbage collection completes', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const { remediateFunctionSecrets } = await import('../../apps/control-plane/function-executor.mjs');
  const api = cluster({ knative: true, deferForegroundDeletion: true });
  const manifest = buildFunctionKsvcManifest('fn-example', 'return 1', scope);
  manifest.spec.template.spec.containers[0].env.push({ name: 'KEY', value: 'legacy-marker' });
  await api.request('POST', servicePath.slice(0, servicePath.lastIndexOf('/')), manifest);
  const options = { ...scope, request: api.request, dryRun: false, secretEnv: [{ name: 'KEY', value: 'new-marker' }] };
  const applied = await remediateFunctionSecrets('fn-example', 'return 1', options);
  assert.deepEqual(applied.pending.map((item) => item.kind), ['Revision', 'Deployment', 'ReplicaSet']);
  assert.equal(JSON.stringify(applied).includes('legacy-marker'), false);
  api.collectGarbage();
  const retried = await remediateFunctionSecrets('fn-example', 'return 1', options);
  assert.deepEqual(retried.pending, []);
  assert.equal(JSON.stringify([...api.objects.values()]).includes('legacy-marker'), false);
});

test('an owner-reference write failure removes both newly created resources', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  const request = (method, path, body, options) => {
    if (method === 'PATCH' && path === secretPath) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    return api.request(method, path, body, options);
  };
  await assert.rejects(deployKnativeService('fn-example', 'return 1', { ...scope, request, secretEnv: [{ name: 'KEY', value: 'marker' }] }));
  assert.equal(api.objects.size, 0);
});

test('the shipped remediation entry point is read-only by default and refuses missing legacy mappings', async () => {
  const { runFunctionSecretRemediation } = await import('../../apps/control-plane/remediate-function-secrets.mjs');
  const api = cluster();
  api.objects.set(servicePath, { metadata: { name: 'fn-example', uid: 'svc-old', resourceVersion: '1', labels: buildFunctionOwnershipLabels(scope) }, spec: { template: { spec: { containers: [{ env: [{ name: 'CUSTOM_KEY', value: 'legacy-marker' }] }] } } } });
  const pool = { query: async () => ({ rows: [{ resource_id: scope.functionResourceId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, ksvc_name: 'fn-example', source_code: 'return 1', secret_refs: [] }] }) };
  const options = { pool, ...scope, resourceId: scope.functionResourceId, request: api.request, vault: { resolveEnv: async () => assert.fail('must not resolve during dry run or with unmapped env') } };
  const report = await runFunctionSecretRemediation(options);
  assert.equal(report.dryRun, true);
  assert.equal(JSON.stringify(report).includes('legacy-marker'), false);
  const applied = await runFunctionSecretRemediation({ ...options, apply: true });
  assert.equal(applied.code, 'FN_REMEDIATION_REFS_REQUIRED');
  assert.deepEqual(applied.unmapped, ['CUSTOM_KEY']);
  assert.equal(api.calls.every((call) => call.method === 'GET'), true);
});

test('adding a projection to an existing Function binds it before mutating the Service', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  await deployKnativeService('fn-example', 'old-source', { ...scope, request: api.request });
  const previous = structuredClone(api.objects.get(servicePath));
  const request = (method, path, body, options) => {
    if (method === 'PATCH' && path === secretPath) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    return api.request(method, path, body, options);
  };
  await assert.rejects(deployKnativeService('fn-example', 'new-source', { ...scope, request, secretEnv: [{ name: 'KEY', value: 'marker' }] }));
  assert.deepEqual(api.objects.get(servicePath), previous);
  assert.equal(api.objects.has(secretPath), false);
});

test('a failed Service update restores the previous declared Secret keys', async (t) => {
  installInvocationFixture(t, invocationFixture());
  const api = cluster();
  await deployKnativeService('fn-example', 'old-source', { ...scope, request: api.request, secretEnv: [{ name: 'OLD', value: 'old-marker' }] });
  const request = (method, path, body, options) => {
    if (method === 'PATCH' && path === servicePath) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
    return api.request(method, path, body, options);
  };
  await assert.rejects(deployKnativeService('fn-example', 'new-source', { ...scope, request, secretEnv: [{ name: 'NEW', value: 'new-marker' }] }));
  assert.deepEqual(api.objects.get(secretPath).data, { OLD: Buffer.from('old-marker').toString('base64') });
});
