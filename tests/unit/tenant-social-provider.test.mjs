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

test('masked admin reads retain the Keycloak preservation sentinel unless replaced', () => {
  const masked = { ...current, config: { clientSecret: '**********' } };
  for (const config of [{}, { clientSecret: '' }, { clientId: 'new-id' }]) {
    assert.equal(mergeSocialProvider(masked, { config }).config.clientSecret, '**********');
  }
  assert.equal(mergeSocialProvider(masked, { config: { clientSecret: secret } }).config.clientSecret, secret);
});

test('provider projection exposes presence, safe config and configured callback only', () => {
  for (const baseUrl of ['https://id.example', 'https://id.example/auth']) {
    for (const clientSecret of [secret, '**********']) {
      const view = socialProviderView({ ...current, config: { ...current.config, clientSecret } }, 'realm name', { KEYCLOAK_ISSUER: `${baseUrl}/realms/platform` });
      assert.equal(view.clientSecretSet, true);
      assert.equal(view.clientId, 'old-id');
      assert.equal(view.callbackUrl, `${baseUrl}/realms/realm%20name/broker/google/endpoint`);
      assert.equal('config' in view, false);
      assert.equal('clientSecret' in view, false);
      assert.ok(!JSON.stringify(view).includes(clientSecret));
    }
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
  // Keycloak 26.1.0 admin GET masks secrets; IdentityProviderResource PUT replaces
  // an unchanged SECRET_VALUE with the actual credential before storing the config.
  const adminView = () => ({ ...stored, config: { ...stored.config,
    ...(stored.config.clientSecret ? { clientSecret: '**********' } : {}) } });
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    if (path.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (method === 'GET' && path.endsWith('/instances')) return Response.json(stored ? [adminView()] : []);
    if (method === 'GET') return stored ? Response.json(adminView()) : Response.json({}, { status: 404 });
    const next = JSON.parse(init.body);
    writes.push([method, structuredClone(next)]);
    if (failWrite) return Response.json({ error: secret }, { status: 500 });
    if (method === 'PUT' && next.config.clientSecret === '**********') {
      next.config.clientSecret = stored.config.clientSecret;
    }
    stored = next;
    return new Response(null, { status: method === 'POST' ? 201 : 204 });
  });
  for (const config of [{ clientId: 'new-id' }, { clientSecret: '' }, {}]) {
    await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', enabled: false, config });
    assert.equal(writes.at(-1)[0], 'PUT');
    assert.equal(writes.at(-1)[1].config.clientSecret, '**********');
    assert.equal(stored.config.clientSecret, secret);
    assert.equal(stored.enabled, false);
    assert.equal(stored.config.providerSpecific, 'retained');
  }
  // The console toggle has no config at all; toggling back must also preserve it.
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', enabled: true });
  assert.equal(stored.enabled, true);
  assert.equal(writes.at(-1)[1].config.clientSecret, '**********');
  assert.equal(stored.config.clientSecret, secret);
  const list = await kcAdmin.listIdentityProviders('tenant');
  assert.equal(list[0].clientSecretSet, true);
  assert.ok(!JSON.stringify(list).includes(secret));
  assert.ok(!JSON.stringify(list).includes('**********'));
  const beforeMismatch = writes.length;
  await assert.rejects(kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'github', config: {} }), { code: 'SOCIAL_PROVIDER_VALIDATION_ERROR', statusCode: 400 });
  assert.equal(writes.length, beforeMismatch);
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientSecret: 'replacement' } });
  assert.equal(stored.config.clientSecret, 'replacement');
  stored = null;
  const before = writes.length;
  await assert.rejects(kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientId: 'test' } }), { code: 'SOCIAL_PROVIDER_VALIDATION_ERROR', statusCode: 400 });
  assert.equal(writes.length, before);
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { clientId: 'test', clientSecret: secret } });
  assert.equal(writes.at(-1)[0], 'POST');
  await kcAdmin.upsertIdentityProvider('tenant', { alias: 'google', providerId: 'google', config: { defaultScope: '' }, displayName: '', enabled: false });
  assert.equal(stored.config.clientSecret, secret);
  assert.equal(stored.config.defaultScope, '');
  assert.equal(stored.displayName, '');
  assert.equal(stored.enabled, false);
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
