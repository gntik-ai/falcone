import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin } from '../../apps/control-plane/kc-admin.mjs';
import { mergeSocialProvider, socialProviderView, validateSocialProvider } from '../../apps/control-plane/social-providers.mjs';

const secret = 'dummy-social-secret-950';
const current = { alias: 'google', providerId: 'google', enabled: true, displayName: 'Google',
  config: { clientId: 'old-id', clientSecret: secret, defaultScope: 'email', providerSpecific: 'retained' } };

test('secret is preserved for missing/empty patches and replaced only for a non-empty patch', () => {
  for (const config of [{ clientId: 'new-id' }, { clientSecret: '' }, {}]) {
    const result = mergeSocialProvider(current, { alias: 'google', providerId: 'google', displayName: 'Edited', config });
    assert.equal(result.config.clientSecret, secret);
    assert.equal(result.config.providerSpecific, 'retained');
    assert.equal(result.config.defaultScope, 'email');
    assert.equal(result.enabled, true);
  }
  assert.equal(mergeSocialProvider(current, { config: { clientSecret: 'replacement' } }).config.clientSecret, 'replacement');
});

test('masked admin reads fail closed unless a real replacement is supplied', () => {
  const masked = { ...current, config: { clientSecret: '**********' } };
  for (const config of [{}, { clientSecret: '' }, { clientSecret: '**********' }]) {
    assert.throws(() => mergeSocialProvider(masked, { config }), { code: 'MASKED_IDENTITY_PROVIDER_SECRET' });
  }
  assert.equal(mergeSocialProvider(masked, { config: { clientSecret: secret } }).config.clientSecret, secret);
});

test('provider projection exposes presence, safe config and configured callback only', () => {
  for (const clientSecret of [secret, '**********']) {
    const view = socialProviderView({ ...current, config: { ...current.config, clientSecret } }, 'realm name', { KEYCLOAK_ISSUER: 'https://id.example/auth/realms/platform' });
    assert.equal(view.clientSecretSet, true);
    assert.equal(view.clientId, 'old-id');
    assert.equal(view.callbackUrl, 'https://id.example/auth/realms/realm%20name/broker/google/endpoint');
    assert.equal('config' in view, false);
    assert.equal('clientSecret' in view, false);
    assert.ok(!JSON.stringify(view).includes(clientSecret));
  }
  for (const env of [{}, { KEYCLOAK_ISSUER: 'not-a-url' }, { KEYCLOAK_ISSUER: 'http://user:password@id.example/realms/platform' }]) {
    assert.equal(socialProviderView(current, 'tenant', env).callbackUrl, null);
  }
});

test('validation restricts built-in templates and credential config surface', () => {
  assert.equal(validateSocialProvider('google', { config: { clientId: 'test', clientSecret: secret } }), null);
  for (const [alias, patch] of [['../google', {}], ['google', { providerId: 'oidc' }], ['google', { config: { tokenUrl: 'http://untrusted' } }], ['google', { config: { clientSecret: '**********' } }]]) {
    assert.equal(typeof validateSocialProvider(alias, patch), 'string');
  }
});

test('real Keycloak adapter uses read-merge-PUT; list, create and upstream errors never expose credentials', async (t) => {
  const writes = [];
  let stored = structuredClone(current);
  let failWrite = false;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    if (path.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (method === 'GET' && path.endsWith('/instances')) return Response.json(stored ? [stored] : []);
    if (method === 'GET') return stored ? Response.json(stored) : Response.json({}, { status: 404 });
    writes.push([method, JSON.parse(init.body)]);
    if (failWrite) return Response.json({ error: secret }, { status: 500 });
    stored = JSON.parse(init.body);
    return new Response(null, { status: method === 'POST' ? 201 : 204 });
  });
  for (const config of [{ clientId: 'new-id' }, { clientSecret: '' }, {}]) {
    await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', enabled: false, config });
    assert.equal(writes.at(-1)[0], 'PUT');
    assert.equal(writes.at(-1)[1].config.clientSecret, secret);
    assert.equal(stored.enabled, false);
    assert.equal(stored.config.providerSpecific, 'retained');
  }
  assert.ok(!JSON.stringify(await kcAdmin.listIdentityProviders('tenant')).includes(secret));
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientSecret: 'replacement' } });
  assert.equal(stored.config.clientSecret, 'replacement');
  stored = null;
  const before = writes.length;
  await assert.rejects(kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientId: 'test' } }));
  assert.equal(writes.length, before);
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientId: 'test', clientSecret: secret } });
  assert.equal(writes.at(-1)[0], 'POST');
  stored.config.clientSecret = '**********';
  const beforeMasked = writes.length;
  await assert.rejects(kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: {} }), (error) => error.statusCode === 409);
  assert.equal(writes.length, beforeMasked);
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientSecret: secret } });
  assert.equal(stored.config.clientSecret, secret);
  failWrite = true;
  await assert.rejects(kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: {} }), (error) => {
    assert.equal(error.upstreamBody, null);
    assert.ok(!String(error.diagnosticMessage).includes(secret));
    assert.ok(!JSON.stringify(error).includes(secret));
    return true;
  });
});
