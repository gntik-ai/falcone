import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInvokeHeaders, buildFunctionKsvcManifest, buildFunctionOwnershipLabels, deployKnativeService, invokeKnative } from '../../apps/control-plane/function-executor.mjs';
import { mintInvocationCredential, invocationPublicJwks } from '../../apps/control-plane/function-invocation-auth.mjs';
import { createInvocationVerifier } from '../../apps/fn-runtime/invocation-auth.mjs';
import { createRuntimeServer } from '../../apps/fn-runtime/server.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { createWorkspaceSecretStore } from '../../apps/control-plane/vault-secrets.mjs';
import { invocationFixture, installInvocationFixture, runtimeRequest } from '../helpers/function-invocation-fixture.mjs';

const active = invocationFixture();
const retiring = invocationFixture('test-retiring');
const target = { audience: 'fn-app-hello-abc', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
const caller = { tenantId: 'tenant-a', workspaceId: 'workspace-a', principal: 'user-a', actorType: 'tenant_member', roles: ['workspace_owner'] };
const env = {
  FN_INVOCATION_JWKS: active.env.FN_INVOCATION_JWKS,
  K_SERVICE: target.audience, FN_TENANT_ID: target.tenantId, FN_WORKSPACE_ID: target.workspaceId,
};
const credential = mintInvocationCredential('{}', caller, target, active.env);
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
const claims = decode(credential.split('.')[1]);
const header = decode(credential.split('.')[0]);

function signerMount(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'function-signer-'));
  const previous = process.env.FN_INVOCATION_SECRET_DIR;
  process.env.FN_INVOCATION_SECRET_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.FN_INVOCATION_SECRET_DIR;
    else process.env.FN_INVOCATION_SECRET_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    project(fixture, revision) {
      const snapshot = path.join(directory, revision);
      fs.mkdirSync(snapshot);
      for (const [name, value] of Object.entries({
        'private-key': fixture.env.FN_INVOCATION_PRIVATE_KEY,
        'key-id': fixture.env.FN_INVOCATION_KEY_ID,
        jwks: fixture.env.FN_INVOCATION_JWKS,
      })) fs.writeFileSync(path.join(snapshot, name), value, { mode: 0o600 });
      fs.symlinkSync(revision, path.join(directory, '..data-next'));
      fs.renameSync(path.join(directory, '..data-next'), path.join(directory, '..data'));
    },
  };
}
function signed(changes = {}, headerChanges = {}, key = active.privateKey) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${encode({ ...header, ...headerChanges })}.${encode({ ...claims, ...changes })}`;
  return `${input}.${sign(null, Buffer.from(input), key).toString('base64url')}`;
}

const negatives = [
  ['missing', undefined],
  ['malformed', 'Bearer malformed'],
  ['unsigned', `Bearer ${credential.split('.').slice(0, 2).join('.')}.AA`],
  ['tampered', `Bearer ${credential.split('.')[0]}.${Buffer.from(JSON.stringify({ ...claims, caller: { ...caller, principal: 'admin' } })).toString('base64url')}.${credential.split('.')[2]}`],
  ['wrong audience', `Bearer ${signed({ aud: 'fn-other' })}`],
  ['wrong tenant', `Bearer ${signed({ tenantId: 'tenant-b' })}`],
  ['wrong workspace', `Bearer ${signed({ workspaceId: 'workspace-b' })}`],
  ['expired', `Bearer ${signed({ iat: claims.iat - 61, exp: claims.iat - 1 })}`],
  ['future issued', `Bearer ${signed({ iat: claims.iat + 120, exp: claims.iat + 180 })}`],
  ['overlong lifetime', `Bearer ${signed({ exp: claims.iat + 61 })}`],
  ['missing jti', `Bearer ${signed({ jti: null })}`],
  ['unknown kid', `Bearer ${signed({}, { kid: 'unknown' })}`],
  ['none algorithm', `Bearer ${signed({}, { alg: 'none' })}`],
  ['symmetric algorithm', `Bearer ${signed({}, { alg: 'HS256' })}`],
  ['wrong signing key', `Bearer ${signed({}, {}, retiring.privateKey)}`],
  ['malformed caller', `Bearer ${signed({ caller: { ...caller, roles: 'admin' } })}`],
];

test('signed invocation verifies target/body/caller and rejects replays at expiry', () => {
  const verify = createInvocationVerifier(env);
  assert.deepEqual(verify(`Bearer ${credential}`, '{}', claims.iat), caller);
  assert.equal(verify(`Bearer ${credential}`, '{"tampered":true}', claims.iat), null);
  assert.equal(verify(`Bearer ${credential}`, '{}', claims.exp), null);
  assert.equal(verify(`Bearer ${credential}`, '{}', claims.exp + 300), null);
  for (const [name, authorization] of negatives) assert.equal(verify(authorization, '{}', claims.iat), null, name);
});

test('issuance allows at most three seconds of clock skew without extending expiry or lifetime', () => {
  const verify = createInvocationVerifier(env);
  for (const offset of [1, 2, 3]) {
    assert.deepEqual(verify(`Bearer ${credential}`, '{}', claims.iat - offset), caller);
  }
  assert.equal(verify(`Bearer ${credential}`, '{}', claims.iat - 4), null);
  assert.deepEqual(verify(`Bearer ${credential}`, '{}', claims.exp - 1), caller);
  assert.equal(verify(`Bearer ${credential}`, '{}', claims.exp), null);
  assert.equal(verify(`Bearer ${signed({ exp: claims.iat + 61 })}`, '{}', claims.iat - 3), null);
});

test('overlapping public keys verify active and retiring credentials; configuration is captured', () => {
  const config = { ...env, FN_INVOCATION_JWKS: JSON.stringify({ keys: [active.jwk, retiring.jwk] }) };
  const verify = createInvocationVerifier(config);
  config.K_SERVICE = 'fn-other';
  config.FN_INVOCATION_JWKS = 'invalid';
  assert.deepEqual(verify(`Bearer ${credential}`, '{}', claims.iat), caller);
  const oldCredential = mintInvocationCredential('{}', caller, target, retiring.env);
  assert.deepEqual(verify(`Bearer ${oldCredential}`, '{}'), caller);
  assert.equal(createInvocationVerifier(env)(`Bearer ${oldCredential}`, '{}'), null);
});

test('missing, duplicate, malformed or private public-key configuration fails closed', () => {
  for (const value of [undefined, 'invalid', '{"keys":[]}', JSON.stringify({ keys: [active.jwk, active.jwk] }),
    JSON.stringify({ keys: [{ ...active.jwk, d: 'invalid-private-material' }] })]) {
    assert.equal(createInvocationVerifier({ ...env, FN_INVOCATION_JWKS: value })(`Bearer ${credential}`, '{}'), null);
    assert.throws(() => invocationPublicJwks({ FN_INVOCATION_JWKS: value }), /public keys are not configured/);
  }
  assert.equal(createInvocationVerifier({ ...env, FN_WORKSPACE_ID: '' })(`Bearer ${credential}`, '{}'), null);
  assert.throws(() => mintInvocationCredential('{}', caller, target, { ...active.env, FN_INVOCATION_PRIVATE_KEY: 'invalid-private-material' }),
    (e) => e.message === 'Function invocation signing is not configured correctly');
  assert.throws(() => mintInvocationCredential('{}', caller, target, { ...active.env, FN_INVOCATION_JWKS: retiring.env.FN_INVOCATION_JWKS }), /signing is not configured/);
});

test('late ESO projection restores deploy and invoke without restarting, and rotation refreshes signing', async (t) => {
  installInvocationFixture(t, active);
  const mount = signerMount(t);
  const options = { tenantId: target.tenantId, workspaceId: target.workspaceId, functionResourceId: 'fn-resource-a' };
  let calls = 0;
  let expectedKid = active.jwk.kid;
  const verify = createInvocationVerifier({ ...env, FN_INVOCATION_JWKS: JSON.stringify({ keys: [active.jwk, retiring.jwk] }) });
  t.mock.method(http, 'request', (requestOptions, receive) => {
    calls++;
    const req = new EventEmitter();
    let body;
    req.write = (value) => { body = value; };
    req.end = () => {
      assert.deepEqual(verify(requestOptions.headers.authorization, body), caller);
      const tokenHeader = decode(requestOptions.headers.authorization.slice(7).split('.')[0]);
      assert.equal(tokenHeader.kid, expectedKid);
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      receive(response);
      response.emit('data', JSON.stringify({ status: 'success', result: { ok: true } }));
      response.emit('end');
    };
    return req;
  });
  // Even valid stale env must not override the missing authoritative mount.
  assert.equal((await invokeKnative('fn.example', {}, { ...target, caller })).statusCode, 503);
  assert.equal(calls, 0);
  assert.throws(() => buildFunctionKsvcManifest(target.audience, '', options),
    (error) => error.message === 'Function invocation public keys are not configured correctly');

  mount.project(active, '..revision-1');
  for (const fixture of [active, retiring]) {
    if (fixture === retiring) mount.project(retiring, '..revision-2');
    expectedKid = fixture.jwk.kid;
    const manifest = buildFunctionKsvcManifest(target.audience, '', options);
    const entries = manifest.spec.template.spec.containers[0].env;
    assert.deepEqual(JSON.parse(entries.find((entry) => entry.name === 'FN_INVOCATION_JWKS').value), { keys: [fixture.jwk] });
    assert.equal(entries.some((entry) => ['FN_INVOCATION_PRIVATE_KEY', 'FN_INVOCATION_SECRET_DIR'].includes(entry.name)), false);
    assert.equal(JSON.stringify(manifest).includes(fixture.env.FN_INVOCATION_PRIVATE_KEY), false);
    assert.equal((await invokeKnative('fn.example', {}, { ...target, caller })).statusCode, 200);
  }
  assert.equal(calls, 2);
  fs.unlinkSync(path.join(mount.directory, '..data'));
  assert.equal((await invokeKnative('fn.example', {}, { ...target, caller })).statusCode, 503);
  assert.equal(calls, 2);
});

test('mounted configuration pins the projection, supports direct files and redacts malformed material', (t) => {
  const mount = signerMount(t);
  mount.project(active, '..revision-1');
  // Reading the resolved projection ignores inconsistent top-level file links.
  for (const [name, value] of Object.entries({
    'private-key': 'invalid-private-material', 'key-id': 'wrong-kid', jwks: 'invalid-public-material',
  })) fs.writeFileSync(path.join(mount.directory, name), value);
  const token = mintInvocationCredential('{}', caller, target);
  assert.deepEqual(createInvocationVerifier(env)(`Bearer ${token}`, '{}'), caller);
  assert.deepEqual(invocationPublicJwks(), { keys: [active.jwk] });
  fs.unlinkSync(path.join(mount.directory, '..data'));
  assert.throws(() => mintInvocationCredential('{}', caller, target),
    (error) => error.message === 'Function invocation signing is not configured correctly');
  assert.throws(() => invocationPublicJwks(),
    (error) => error.message === 'Function invocation public keys are not configured correctly');
  // Public-key deployment does not require reading the private key.
  fs.writeFileSync(path.join(mount.directory, 'jwks'), active.env.FN_INVOCATION_JWKS);
  fs.unlinkSync(path.join(mount.directory, 'private-key'));
  assert.deepEqual(invocationPublicJwks(), { keys: [active.jwk] });
});

test('runtime returns 401 before source evaluation for every invalid credential; probes stay ready', async (t) => {
  const previous = process.env.FN_SRC;
  process.env.FN_SRC = 'globalThis.issue972Evaluated = true; function main(){ globalThis.issue972Invoked = true; }';
  t.after(() => {
    if (previous === undefined) delete process.env.FN_SRC;
    else process.env.FN_SRC = previous;
    delete globalThis.issue972Evaluated;
    delete globalThis.issue972Invoked;
  });
  const server = createRuntimeServer(env);
  for (const path of ['/', '/health', '/readiness']) {
    assert.equal((await runtimeRequest(server, { method: 'GET', path })).statusCode, 200);
  }
  for (const [name, authorization] of negatives) {
    const headers = { 'x-falcone-tenant-id': 'tenant-a', 'x-falcone-principal': 'admin' };
    if (authorization) headers.authorization = authorization;
    const r = await runtimeRequest(server, { headers, path: '/run' });
    assert.equal(r.statusCode, 401, name);
    assert.deepEqual(r.body, { error: 'Unauthorized invocation' });
  }
  assert.equal(globalThis.issue972Evaluated, undefined);
  assert.equal(globalThis.issue972Invoked, undefined);
});

test('manifest labels actual function pods and injects public-only verification env', (t) => {
  installInvocationFixture(t, active);
  const opts = { tenantId: target.tenantId, workspaceId: target.workspaceId, functionResourceId: 'fn-resource-a' };
  const manifest = buildFunctionKsvcManifest(target.audience, 'function main(){return process.env}', opts);
  assert.equal(manifest.spec.template.metadata.labels['in-falcone.io/component'], 'function');
  const entries = manifest.spec.template.spec.containers[0].env;
  const values = Object.fromEntries(entries.map(({ name, value }) => [name, value]));
  assert.equal(values.FN_KSVC_NAME, target.audience);
  assert.equal(values.FN_TENANT_ID, target.tenantId);
  assert.equal(values.FN_WORKSPACE_ID, target.workspaceId);
  assert.deepEqual(JSON.parse(values.FN_INVOCATION_JWKS), { keys: [active.jwk] });
  assert.ok(!values.FN_INVOCATION_PRIVATE_KEY);
  // Avoid assertion diagnostics containing ephemeral key material.
  assert.equal(JSON.stringify(manifest).includes(active.env.FN_INVOCATION_PRIVATE_KEY), false);
  for (const name of ['FN_INVOCATION_PRIVATE_KEY', 'FN_INVOCATION_KEY_ID', 'FN_INVOCATION_JWKS', 'FN_INVOCATION_SECRET_DIR', 'FN_KSVC_NAME', 'FN_TENANT_ID', 'FN_WORKSPACE_ID', 'FN_SRC', 'K_SERVICE', 'NODE_OPTIONS', 'NODE_PATH']) {
    assert.throws(() => buildFunctionKsvcManifest(target.audience, '', { ...opts, secretEnv: [{ name, value: 'unsafe' }] }),
      (error) => error.statusCode === 400 && /reserved/.test(error.message));
  }
});

test('fn-prefixed workspace secrets retain their default env names and support explicit mappings', async (t) => {
  installInvocationFixture(t, active);
  const secretStore = createWorkspaceSecretStore({ readSecret: async () => ({ data: { value: 'test-placeholder' } }) });
  const secretEnv = await secretStore.resolveEnv(target.tenantId, target.workspaceId, [
    'fn-token',
    { name: 'fn-token', env: 'APP_TOKEN' },
  ]);
  const manifest = buildFunctionKsvcManifest(target.audience, 'function main(){}', {
    tenantId: target.tenantId, workspaceId: target.workspaceId, functionResourceId: 'fn-resource-a', secretEnv,
  });
  const entries = manifest.spec.template.spec.containers[0].env;
  assert.ok(entries.some(({ name, value }) => name === 'APP_TOKEN' && value === 'test-placeholder'));
  assert.ok(entries.some(({ name, value }) => name === 'FN_TOKEN' && value === 'test-placeholder'));
});

test('ownership-checked PATCH idempotently re-rolls labels/public key ring without renaming', async (t) => {
  installInvocationFixture(t, active);
  const opts = { tenantId: target.tenantId, workspaceId: target.workspaceId, functionResourceId: 'fn-resource-a' };
  const patches = [];
  const request = async (method, _path, body, options) => {
    if (method === 'POST') throw Object.assign(new Error('exists'), { statusCode: 409 });
    if (method === 'GET') return { metadata: { resourceVersion: '7', labels: buildFunctionOwnershipLabels(opts) } };
    assert.equal(method, 'PATCH');
    assert.equal(body.metadata.resourceVersion, '7');
    assert.equal(options.contentType, 'application/merge-patch+json');
    patches.push(body);
  };
  await deployKnativeService(target.audience, 'function main(){}', { ...opts, request });
  await deployKnativeService(target.audience, 'function main(){}', { ...opts, request });
  assert.deepEqual(patches[0], patches[1]);
  assert.equal(patches[0].spec.template.metadata.labels['in-falcone.io/component'], 'function');
  process.env.FN_INVOCATION_JWKS = JSON.stringify({ keys: [active.jwk, retiring.jwk] });
  await deployKnativeService(target.audience, 'function main(){}', { ...opts, request });
  const keys = patches[2].spec.template.spec.containers[0].env.find((e) => e.name === 'FN_INVOCATION_JWKS');
  assert.equal(JSON.parse(keys.value).keys.length, 2);
});

test('invokeKnative signs target and redacts untrusted HTTP errors; missing config opens no socket', async (t) => {
  installInvocationFixture(t, active);
  let calls = 0;
  t.mock.method(http, 'request', (options, receive) => {
    calls++;
    const req = new EventEmitter();
    let body;
    req.write = (value) => { body = value; };
    req.end = () => {
      assert.deepEqual(createInvocationVerifier(env)(options.headers.authorization, body), caller);
      const response = new EventEmitter();
      response.statusCode = 401;
      receive(response);
      response.emit('data', options.headers.authorization);
      response.emit('end');
    };
    return req;
  });
  const result = await invokeKnative('fn.example', {}, { ...target, caller });
  assert.equal(result.result.error, 'runtime HTTP 401');
  assert.equal(calls, 1);
  delete process.env.FN_INVOCATION_PRIVATE_KEY;
  const failed = await invokeKnative('fn.example', {}, { ...target, caller });
  assert.equal(failed.statusCode, 503);
  assert.equal(calls, 1);
});

test('fnInvoke waits for cold-start readiness, passes signed target and writes exactly one activation', async (t) => {
  installInvocationFixture(t, active);
  const action = { resource_id: 'fn-resource-a', tenant_id: target.tenantId, workspace_id: target.workspaceId, ksvc_name: target.audience };
  const events = [];
  const activations = [];
  const result = await FN_HANDLERS.fnInvoke({
    params: { actionId: action.resource_id }, body: { parameters: { n: 3 } }, pool: {},
    identity: { sub: caller.principal, tenantId: caller.tenantId, workspaceId: caller.workspaceId, workspaceIds: [caller.workspaceId], roles: caller.roles, actorType: caller.actorType },
    callerContext: { correlationId: 'corr-972' },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }), canServeWorkloads: () => true },
    store: { getFnAction: async () => action, insertFnActivation: async (_pool, input) => activations.push(input) },
    waitKsvcReady: async (name) => { assert.equal(name, target.audience); events.push('ready'); return true; },
    invokeKnative: async (_host, params, options) => {
      events.push('invoke');
      assert.equal(options.audience, target.audience);
      assert.equal(options.tenantId, target.tenantId);
      assert.equal(options.workspaceId, target.workspaceId);
      const payload = JSON.stringify(params);
      const h = buildInvokeHeaders(payload, options.caller, options);
      assert.deepEqual(createInvocationVerifier(env)(h.authorization, payload), caller);
      return { status: 'success', result: { n: params.n }, logs: [], durationMs: 1, statusCode: 200 };
    },
  });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.status, 'completed');
  assert.deepEqual(events, ['ready', 'invoke']);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].statusCode, 200);
});


test('runtime executes a valid Unicode body with signed context, ignores headers and exposes only public env', async (t) => {
  const previous = process.env.FN_SRC;
  t.after(() => {
    if (previous === undefined) delete process.env.FN_SRC;
    else process.env.FN_SRC = previous;
  });
  process.env.FN_SRC = 'function main(params, context){ return { params, context, hasPrivateKey: !!process.env.FN_INVOCATION_PRIVATE_KEY }; }';
  const payload = JSON.stringify({ value: 'é🦅', tenantId: 'SPOOF' });
  const token = mintInvocationCredential(payload, caller, target, active.env);
  const bytes = Buffer.from(payload);
  const r = await runtimeRequest(createRuntimeServer(env), {
    headers: { authorization: `Bearer ${token}`, 'x-falcone-tenant-id': 'SPOOF', 'x-falcone-principal': 'admin' },
    body: [...bytes].map((byte) => Buffer.from([byte])),
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.status, 'success');
  assert.deepEqual(r.body.result.context, caller);
  assert.deepEqual(r.body.result.params, JSON.parse(payload));
  assert.equal(r.body.result.hasPrivateKey, false);
});

test('runtime redacts credentials in captured logs, returned results and thrown errors', async (t) => {
  const previous = process.env.FN_SRC;
  t.after(() => {
    if (previous === undefined) delete process.env.FN_SRC;
    else process.env.FN_SRC = previous;
  });
  const messages = [];
  t.mock.method(console, 'error', (...args) => messages.push(args.join(' ')));
  process.env.FN_SRC = `function main(){ console.log(${JSON.stringify(credential)}); return ${JSON.stringify(credential)}; }`;
  const server = createRuntimeServer(env);
  const response = await runtimeRequest(server, { headers: { authorization: `Bearer ${credential}` } });
  assert.deepEqual(response.body.logs, ['[REDACTED]']);
  assert.equal(response.body.result, '[REDACTED]');
  process.env.FN_SRC = `function main(){ throw new Error(${JSON.stringify(credential)}); }`;
  const failure = await runtimeRequest(server, { headers: { authorization: `Bearer ${credential}` } });
  assert.equal(failure.body.result.error, '[REDACTED]');
  assert.deepEqual(messages, ['[fn-runtime] action threw: [REDACTED]']);
});
