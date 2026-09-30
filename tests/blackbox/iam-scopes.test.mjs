import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../../apps/control-plane/routes.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const REALM = 'acme-realm';
const ACME = 'acme-tenant';
const GLOBEX = 'globex-tenant';
const pool = {
  query: async (sql, args) => /FROM\s+tenants\s+WHERE\s+iam_realm/i.test(sql) && args?.[0] === REALM
    ? { rows: [{ id: ACME, tenant_id: ACME, iam_realm: REALM }] }
    : { rows: [] },
};
const superadmin = { actorType: 'superadmin' };
const owner = { actorType: 'tenant_owner', tenantId: ACME };
const admin = { actorType: 'tenant_admin', tenantId: ACME };
const otherOwner = { actorType: 'tenant_owner', tenantId: GLOBEX };
const otherAdmin = { actorType: 'tenant_admin', tenantId: GLOBEX };

function fakeKc(scopes = []) {
  const calls = [];
  return {
    calls,
    listClientScopes: async (realm) => { calls.push(['scopes', realm]); return scopes; },
    listRealmDefaultClientScopes: async (realm) => { calls.push(['defaults', realm]); return [{ name: 'profile' }]; },
    listRealmOptionalClientScopes: async (realm) => { calls.push(['optionals', realm]); return [{ name: 'email' }]; },
  };
}
function ctx(identity, kcAdmin, realmId = REALM, query = {}) {
  return { identity, kcAdmin, pool, params: { realmId }, query };
}
const scopes = [
  { name: 'profile', protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', display: ['profile'] }, protocolMappers: [
    {
      id: 'private-keycloak-id', name: 'profile mapper', protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-attribute-mapper', consentRequired: false,
      config: {
        'user.attribute': 'profile', 'claim.name': 'profile', multivalued: 'false',
        'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'false',
        'jsonType.label': 'String', 'claim.value': 'private-value',
      },
    },
    { id: 'unknown-id', name: 'unknown mapper', protocolMapper: 'oidc-unknown-mapper', config: { 'claim.name': 'unknown' } },
  ] },
  { name: 'email', protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'false' } },
  { name: 'offline_access' },
];

test('console IAM collection GET routes resolve to registered handlers', () => {
  for (const [suffix, handler] of [['users', 'iamListUsers'], ['roles', 'iamListRoles'], ['scopes', 'iamListScopes'], ['clients', 'iamListClients']]) {
    const route = routes.find((r) => r.method === 'GET' && r.path === `/v1/iam/realms/{realmId}/${suffix}`);
    assert.equal(route?.localHandler, handler);
    assert.equal(typeof LOCAL_HANDLERS[handler], 'function');
  }
  assert.equal(routes.find((r) => r.localHandler === 'iamListScopes')?.auth, 'authenticated');
});

test('superadmin lists mapped scopes with or without a query string', async () => {
  const kc = fakeKc(scopes);
  const result = await LOCAL_HANDLERS.iamListScopes(ctx(superadmin, kc));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 3);
  assert.deepEqual(result.body.page, { after: null, size: 3 });
  assert.deepEqual(result.body.items[0], {
    resourceType: 'iam_scope', realmId: REALM, scopeName: 'profile', protocol: 'openid-connect',
    includeInTokenScope: true, isDefault: true, isOptional: false,
    attributes: { 'include.in.token.scope': ['true'], display: ['profile'] },
    protocolMappers: [{
      name: 'profile mapper', mapperType: 'user_attribute', claimName: 'profile',
      sourceAttribute: 'profile', multivalued: false, tokenTargets: ['access_token', 'id_token'],
    }], assignedClientIds: [],
    providerCompatibility: {
      provider: 'keycloak', contractVersion: '2026-03-24',
      supportedVersions: ['24.x', '25.x', '26.x'], adminApiStability: 'stable_v1',
    },
  });
  assert.equal(result.body.items[1].isOptional, true);
  assert.equal(result.body.items[1].includeInTokenScope, false);
  assert.deepEqual(result.body.items[1].protocolMappers, []);
  assert.deepEqual(result.body.items[2].attributes, {});
  assert.equal(result.body.items[2].protocol, 'openid-connect');
  assert.doesNotMatch(JSON.stringify(result.body), /private-keycloak-id|private-value|unknown-id/);
  assert.deepEqual(kc.calls.map(([name]) => name).sort(), ['defaults', 'optionals', 'scopes']);

  const limited = await LOCAL_HANDLERS.iamListScopes(ctx(superadmin, fakeKc(scopes), REALM, { 'page[size]': '1' }));
  assert.equal(limited.statusCode, 200);
  assert.equal(limited.body.items.length, 1);
  assert.equal(limited.body.total, 1);
  assert.equal(limited.body.page.size, 1);
  const max = await LOCAL_HANDLERS.iamListScopes(ctx(superadmin, fakeKc(scopes), REALM, { max: '2' }));
  assert.equal(max.body.items.length, 2);
});

test('owning tenant owner and admin can list scopes; other tenants cannot', async () => {
  for (const identity of [owner, admin]) {
    const result = await LOCAL_HANDLERS.iamListScopes(ctx(identity, fakeKc(scopes)));
    assert.equal(result.statusCode, 200);
  }
  for (const identity of [otherOwner, otherAdmin]) {
    const kc = fakeKc(scopes);
    const result = await LOCAL_HANDLERS.iamListScopes(ctx(identity, kc));
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.body, { code: 'FORBIDDEN', message: 'requires superadmin or the owning tenant owner/admin' });
    assert.deepEqual(kc.calls, []);
  }
  const kc = fakeKc(scopes);
  const unknown = await LOCAL_HANDLERS.iamListScopes(ctx(owner, kc, 'unknown-realm'));
  assert.equal(unknown.statusCode, 403);
  assert.equal(unknown.body.code, 'FORBIDDEN');
  assert.deepEqual(kc.calls, []);
});

test('Keycloak 404 and 500 return safe IAM errors', async () => {
  for (const kcStatus of [404, 500]) {
    const kc = fakeKc(scopes);
    kc.listClientScopes = async () => { throw Object.assign(new Error('secret credential and stack'), { kcStatus }); };
    const result = await LOCAL_HANDLERS.iamListScopes(ctx(superadmin, kc));
    assert.equal(result.statusCode, kcStatus === 404 ? 404 : 502);
    assert.equal(result.body.code, kcStatus === 404 ? 'REALM_NOT_FOUND' : 'IAM_LIST_SCOPES_FAILED');
    assert.doesNotMatch(JSON.stringify(result.body), /secret|credential|stack/i);
  }
});
