// Uses only public Falcone APIs and the tenant OIDC endpoints. No Keycloak
// operator credential is needed. Picked up by the scheduled real-stack suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';

const configured = !!process.env.CONTROL_PLANE_URL && !!process.env.KEYCLOAK_URL && !!process.env.SUPERADMIN_CLIENT_ID;

test('workspace IAM creation through the real API supports PKCE S256 and rejects direct grants and foreign tenants', {
  skip: !configured && 'real control-plane/Keycloak test environment is not configured',
}, async () => {
  const { getSuperadminToken } = await import('../helpers/auth.mjs');
  const superToken = await getSuperadminToken();
  const cp = process.env.CONTROL_PLANE_URL;
  const kc = process.env.KEYCLOAK_URL;
  const tenants = [];
  async function api(method, path, token, body) {
    const response = await fetch(`${cp}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function tenantFixture() {
    const slug = `iam979-${randomBytes(6).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    const username = `owner-${slug}`;
    const created = await api('POST', '/v1/tenants', superToken, {
      name: slug, slug, ownerUsername: username, ownerPassword: password,
    });
    assert.equal(created.status, 201, 'test tenant creation');
    const id = created.body.tenantId;
    tenants.push(id);
    const workspace = await api('POST', `/v1/tenants/${id}/workspaces`, superToken, { name: 'IAM test workspace' });
    assert.equal(workspace.status, 201, 'test workspace creation');
    const response = await fetch(`${kc}/realms/${created.body.iamRealm}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: `${slug}-app`, username, password }),
    });
    assert.equal(response.status, 200, 'test tenant owner authentication');
    const { access_token: token } = await response.json();
    return { id, realm: created.body.iamRealm, workspaceId: workspace.body.workspaceId, token, username, password };
  }
  try {
    const own = await tenantFixture();
    const other = await tenantFixture();
    const path = `/v1/workspaces/${own.workspaceId}/iam/clients`;
    const clientId = 'wizard-pkce';
    const redirectUri = 'https://app.example.test/callback';
    const payload = { clientType: 'public', clientId, redirectUris: [redirectUri], scopes: ['openid', 'profile', 'email'], permissions: [] };
    const created = await api('POST', path, own.token, payload);
    assert.equal(created.status, 201, 'wizard POST creates a client');
    assert.equal(created.body.realm, own.realm);
    assert.equal(created.body.workspaceId, own.workspaceId);
    assert.equal(typeof created.body.iamClientId, 'string');
    assert.equal(Object.hasOwn(created.body, 'clientSecret'), false);
    const replay = await api('POST', path, own.token, payload);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.iamClientId, created.body.iamClientId);
    const forbidden = await api('POST', path, other.token, { ...payload, clientId: 'foreign-attempt' });
    assert.equal(forbidden.status, 403);
    const list = await api('GET', `/v1/iam/realms/${own.realm}/clients`, superToken);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.filter((c) => c.clientId === clientId).length, 1);
    assert.equal(list.body.items.find((c) => c.clientId === clientId).publicClient, true);
    assert.equal(list.body.items.some((c) => c.clientId === 'foreign-attempt'), false);

    const oidc = `${kc}/realms/${own.realm}/protocol/openid-connect`;
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(16).toString('hex');
    const authorize = new URL(`${oidc}/auth`);
    authorize.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid profile email', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    const cookies = new Map();
    function saveCookies(response) {
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0]; const split = pair.indexOf('=');
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
    }
    const login = await fetch(authorize, { redirect: 'manual' });
    assert.equal(login.status, 200, 'S256 authorization reaches the login form');
    saveCookies(login);
    const html = await login.text();
    const form = html.match(/<form\b[^>]*>/g)?.find((tag) => /id=["']kc-form-login["']/.test(tag));
    const action = form?.match(/action=["']([^"']+)["']/)?.[1]?.replaceAll('&amp;', '&');
    assert.ok(action, 'Keycloak login form has a submission target');
    const loginUrl = new URL(action, authorize);
    assert.equal(loginUrl.origin, authorize.origin, 'test credentials stay on the Keycloak origin');
    const authenticated = await fetch(loginUrl, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      body: new URLSearchParams({ username: own.username, password: own.password, credentialId: '' }),
    });
    assert.equal(authenticated.status, 302, 'tenant owner completes the auth-code login');
    const callback = new URL(authenticated.headers.get('location'));
    assert.equal(callback.origin, new URL(redirectUri).origin);
    assert.equal(callback.searchParams.get('state'), state);
    const code = callback.searchParams.get('code');
    assert.ok(code, 'auth-code returned');
    const exchanged = await fetch(`${oidc}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }),
    });
    assert.equal(exchanged.status, 200, 'auth code exchanges with the S256 verifier');
    assert.equal(typeof (await exchanged.json()).access_token, 'string');
    const direct = await fetch(`${oidc}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: clientId, username: own.username, password: own.password }),
    });
    assert.equal(direct.status, 400, 'direct access grants disabled');
    assert.equal((await direct.json()).error, 'unauthorized_client');
    const plain = new URL(authorize); plain.searchParams.set('code_challenge_method', 'plain');
    const rejected = await fetch(plain, { redirect: 'manual' });
    assert.ok([302, 400].includes(rejected.status), 'plain PKCE rejected');
    if (rejected.status === 302) assert.equal(new URL(rejected.headers.get('location')).searchParams.get('error'), 'invalid_request');

    for (const clientType of ['confidential', 'service_account']) {
      const body = { ...payload, clientId: `wizard-${clientType}`, clientType, redirectUris: clientType === 'service_account' ? [] : [redirectUri] };
      const result = await api('POST', path, own.token, body);
      assert.equal(result.status, 201);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(typeof result.body.clientSecret, 'string');
      const retry = await api('POST', path, own.token, body);
      assert.equal(retry.status, 200);
      assert.equal(Object.hasOwn(retry.body, 'clientSecret'), false);
    }
  } finally {
    for (const tenantId of tenants.reverse()) {
      const cleanup = await api('POST', `/v1/tenants/${tenantId}/purge`, superToken, {});
      assert.ok(cleanup.status < 300, 'dispose test tenant and realm');
    }
  }
});
