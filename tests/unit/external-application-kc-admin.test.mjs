import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin, KEYCLOAK_ADMIN_SAFE_MESSAGE } from '../../apps/control-plane/kc-admin.mjs';

test('external OIDC clients configure declared flows, PKCE and redirect URIs without retrieving secrets', async () => {
  const originalFetch = globalThis.fetch;
  const clients = [];
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-admin-token', expires_in: 300 }));
    }
    assert.ok(url.endsWith('/admin/realms/tenant%2Frealm/clients'), 'only the client creation endpoint is called');
    assert.equal(init.method, 'POST');
    clients.push(JSON.parse(init.body));
    return new Response(null, { status: 201, headers: { location: `${url}/client-${clients.length}` } });
  };
  try {
    for (const [clientType, authenticationFlows] of [
      ['public', ['oidc_authorization_code_pkce']],
      ['confidential', ['oidc_authorization_code_client_secret', 'oidc_client_credentials']],
      ['confidential', ['oidc_client_credentials']],
    ]) {
      const uuid = await kcAdmin.createOidcAppClient('tenant/realm', {
        clientId: 'registered-app', name: 'Registered app', clientType, authenticationFlows,
        redirectUris: ['https://app.example.test/callback'], webOrigins: ['https://app.example.test'],
        protocolMappers: [{ protocolMapper: 'oidc-hardcoded-claim-mapper', config: { 'claim.name': 'actor_type', 'claim.value': 'superadmin' } }],
        postLogoutRedirectUris: ['https://app.example.test/logged-out'],
      });
      assert.equal(uuid, `client-${clients.length}`);
      const client = clients.at(-1);
      assert.equal(client.clientId, 'registered-app');
      assert.equal(client.protocol, 'openid-connect');
      assert.equal(client.enabled, true);
      assert.equal(client.publicClient, clientType === 'public');
      assert.equal(client.standardFlowEnabled, authenticationFlows.some((flow) => flow.startsWith('oidc_authorization_code_')));
      assert.equal(client.serviceAccountsEnabled, authenticationFlows.includes('oidc_client_credentials'));
      assert.equal(client.directAccessGrantsEnabled, false);
      assert.equal(client.attributes['pkce.code.challenge.method'], clientType === 'public' ? 'S256' : undefined);
      assert.equal(client.attributes['in-falcone.kind'], 'external-application');
      assert.equal(client.attributes['post.logout.redirect.uris'], 'https://app.example.test/logged-out');
      assert.deepEqual(client.redirectUris, ['https://app.example.test/callback']);
      assert.deepEqual(client.webOrigins, ['https://app.example.test']);
      assert.equal('defaultClientScopes' in client, false, 'preserve the realm default scopes');
      assert.equal('optionalClientScopes' in client, false, 'preserve the realm optional scopes');
      assert.equal('protocolMappers' in client, false, 'never forward caller-defined mappers');
      assert.equal(client.secret, undefined);
    }
    await kcAdmin.createOidcAppClient('tenant/realm', {
      clientId: 'explicit-scopes', clientType: 'public',
      defaultClientScopes: ['openid', 'profile', 'roles'], optionalClientScopes: ['email'],
    });
    assert.deepEqual(clients.at(-1).defaultClientScopes, ['profile', 'roles'], 'openid is not a Keycloak client scope');
    assert.deepEqual(clients.at(-1).optionalClientScopes, ['email']);
    await kcAdmin.createConfidentialClient('tenant/realm', { clientId: 'existing-service-account' });
    assert.equal(clients.at(-1).attributes['in-falcone.kind'], 'service-account');
    assert.equal(clients.at(-1).standardFlowEnabled, false);
    assert.equal(clients.at(-1).serviceAccountsEnabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('external OIDC client helper rejects arbitrary client scopes before any admin request', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('unsafe client scopes must not reach Keycloak'); };
  try {
    for (const clientType of ['public', 'confidential']) {
      for (const field of ['defaultClientScopes', 'optionalClientScopes']) {
        await assert.rejects(kcAdmin.createOidcAppClient('tenant/realm', {
          clientId: 'app', clientType, [field]: ['privileged-scope'],
        }), { message: KEYCLOAK_ADMIN_SAFE_MESSAGE });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('external OIDC client creation retains safe Keycloak error handling', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-admin-token', expires_in: 300 }));
    }
    return new Response(JSON.stringify({ secret: 'upstream-secret-canary' }), { status: 500 });
  };
  try {
    await assert.rejects(kcAdmin.createOidcAppClient('tenant/realm', {
      clientId: 'app', clientType: 'public', authenticationFlows: ['oidc_authorization_code_pkce'],
    }), (error) => {
      assert.equal(error.kcStatus, 500);
      assert.equal(error.message, KEYCLOAK_ADMIN_SAFE_MESSAGE);
      assert.doesNotMatch(JSON.stringify(error), /upstream-secret-canary|test-admin-token/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('external OIDC retirement disables the exact client UUID and redacts upstream failures', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamStatus = 204;
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-admin-token', expires_in: 300 }));
    }
    assert.ok(url.endsWith('/admin/realms/tenant%2Frealm/clients/client%2Fuuid'));
    assert.equal(init.method, 'PUT');
    assert.deepEqual(JSON.parse(init.body), { enabled: false });
    return new Response(upstreamStatus === 204 ? null : JSON.stringify({ secret: 'disable-secret-canary' }), { status: upstreamStatus });
  };
  try {
    await kcAdmin.setClientEnabled('tenant/realm', 'client/uuid', false);
    upstreamStatus = 500;
    await assert.rejects(kcAdmin.setClientEnabled('tenant/realm', 'client/uuid', false), (error) => {
      assert.equal(error.kcStatus, 500);
      assert.equal(error.message, KEYCLOAK_ADMIN_SAFE_MESSAGE);
      assert.doesNotMatch(JSON.stringify(error), /disable-secret-canary|test-admin-token/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
