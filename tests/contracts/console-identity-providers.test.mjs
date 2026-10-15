import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { auditEventForRoute } from '../../apps/control-plane/audit-writer.mjs';

const document = JSON.parse(readFileSync(new URL('../../apps/control-plane-executor/openapi/control-plane.openapi.json', import.meta.url)));
const path = '/v1/tenants/{tenantId}/auth-config/identity-providers/{alias}';
function resolve(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    assert.ok(value.$ref.startsWith('#/'));
    if (seen.has(value.$ref)) return {};
    return resolve(value.$ref.slice(2).split('/').reduce((obj, key) => obj[key], document), new Set([...seen, value.$ref]));
  }
  return Array.isArray(value) ? value.map(v => resolve(v, seen)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, seen)]));
}
function hasSecretKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key === 'clientSecret' || hasSecretKey(child));
}
test('identity-provider request secret is writeOnly and unreachable from responses or examples', () => {
  const put = document.paths[path]?.put;
  assert.ok(put, 'identity-provider PUT is published');
  const request = resolve(put.requestBody.content['application/json'].schema);
  assert.equal(request.properties.config.properties.clientSecret.writeOnly, true);
  for (const op of [put, document.paths[path].delete, document.paths['/v1/tenants/{tenantId}/auth-config'].get, document.paths['/v1/tenants/{tenantId}/auth-config'].put]) {
    assert.equal(hasSecretKey(resolve(op.responses)), false);
  }
  function checkExamples(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['example', 'examples'].includes(key)) assert.equal(hasSecretKey(child), false);
      else checkExamples(child);
    }
  }
  checkExamples(document);
});

const pool = { async query() { return { rows: [{ id: 'tenant-a', iam_realm: 'tenant-a' }] }; } };
const owner = { sub: 'owner', actorType: 'tenant_owner', tenantId: 'tenant-a' };
function context(identity, body = {}) {
  return { identity, pool, params: { tenantId: 'tenant-a', alias: 'github' }, body, query: {},
    kcAdmin: { async getRealmAuthConfig() { return { identityProviders: [] }; },
      async upsertIdentityProvider() {}, async deleteIdentityProvider() {} } };
}
for (const handler of ['setSocialProvider', 'deleteSocialProvider']) {
  for (const identity of [{ ...owner, actorType: 'workspace_admin' }, { ...owner, tenantId: 'tenant-b' }]) {
    test(`${handler} denies ${identity.actorType} in ${identity.tenantId}`, async () => {
      const ctx = context(identity);
      ctx.kcAdmin = new Proxy({}, { get() { assert.fail('forbidden caller must not reach Keycloak'); } });
      const result = await LOCAL_HANDLERS[handler](ctx);
      assert.equal(result.statusCode, 403);
      assert.equal(result.body.code, 'FORBIDDEN');
    });
  }
}
test('invalid identity-provider body returns 400', async () => {
  const result = await LOCAL_HANDLERS.setSocialProvider(context(owner, { enabled: 'yes' }));
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'VALIDATION_ERROR');
});
test('identity-provider responses, logs and audit records redact synthetic secret material on success and failure', async (t) => {
  const logs = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
  const secret = 'SYNTHETIC-CLIENT-SECRET-DO-NOT-USE';
  const ctx = context(owner, { providerId: 'github', config: { clientId: 'placeholder-client', clientSecret: secret } });
  let written = false;
  ctx.kcAdmin.getRealmAuthConfig = async () => ({ identityProviders: written ? [{ alias: 'github', providerId: 'github', config: ctx.body.config }] : [] });
  ctx.kcAdmin.upsertIdentityProvider = async () => { written = true; };
  const success = await LOCAL_HANDLERS.setSocialProvider(ctx);
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.identityProviders[0].clientSecretSet, true);
  assert.equal(hasSecretKey(success.body), false);
  ctx.kcAdmin.upsertIdentityProvider = async () => { throw new Error(`upstream echoed ${secret}`); };
  const failure = await LOCAL_HANDLERS.setSocialProvider(ctx);
  assert.equal(failure.statusCode, 502);
  const audit = auditEventForRoute({ method: 'PUT', path, localHandler: 'setSocialProvider' }, ctx, success);
  assert.ok(audit);
  assert.ok(!JSON.stringify({ success, failure, audit, logs }).includes(secret));
  assert.equal(hasSecretKey(audit), false);
});
