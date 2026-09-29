import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_HANDLERS } from '../../apps/control-plane/auth-handlers.mjs';

const tenant = { id: 'tenant-a', slug: 'alpha', status: 'active', iam_realm: 'realm/a' };
const jwt = `e30.${Buffer.from(JSON.stringify({ sub: 'user-a', tenant_id: tenant.id })).toString('base64url')}.`;

function context(body, row = tenant) {
  const calls = [];
  const lookups = [];
  return {
    calls,
    lookups,
    ctx: {
      body,
      params: { sessionId: 'session-a' },
      pool: { async query(_sql, params) { lookups.push(params[0]); return { rows: row ? [row] : [] }; } },
      async _fetch(url, init) {
        calls.push({ url, form: new URLSearchParams(init.body) });
        if (url.endsWith('/logout')) return { ok: true, status: 204 };
        return { ok: true, status: 200, async json() { return {
          access_token: jwt, refresh_token: 'example-refresh', expires_in: 300
        }; } };
      }
    }
  };
}

test('tenant login resolves realm and client from the active tenant row', async () => {
  const { ctx, calls, lookups } = context({ username: 'alice', password: 'example', tenantId: tenant.id, realm: 'wrong', client_id: 'wrong' });
  const result = await AUTH_HANDLERS.login(ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.principal.userId, 'user-a');
  assert.deepEqual(result.body.principal.tenantIds, [tenant.id]);
  assert.deepEqual(lookups, [tenant.id]);
  assert.match(calls[0].url, /\/realms\/realm%2Fa\/protocol\/openid-connect\/token$/);
  assert.equal(calls[0].form.get('client_id'), 'alpha-app');
});

test('platform login retains its realm and client without a tenant lookup', async () => {
  const { ctx, calls, lookups } = context({ username: 'admin', password: 'example' });
  assert.equal((await AUTH_HANDLERS.login(ctx)).statusCode, 201);
  assert.deepEqual(lookups, []);
  assert.match(calls[0].url, /\/realms\/in-falcone-platform\/protocol\/openid-connect\/token$/);
  assert.equal(calls[0].form.get('client_id'), 'in-falcone-console');
});

test('invalid tenant state and foreign tenant credentials never reach Keycloak', async () => {
  for (const row of [null, { ...tenant, iam_realm: null }, { ...tenant, status: 'suspended' }, { ...tenant, id: 'tenant-b' }]) {
    const { ctx, calls } = context({ username: 'alice', password: 'example', tenantId: tenant.id }, row);
    const result = await AUTH_HANDLERS.login(ctx);
    assert.equal(result.statusCode, 401);
    assert.equal(result.body.code, 'INVALID_CREDENTIALS');
    assert.equal(result.body.message, 'Invalid user credentials');
    assert.deepEqual(calls, []);
  }
});

test('missing credentials fail before tenant lookup', async () => {
  const { ctx, calls, lookups } = context({ username: 'alice', tenantId: tenant.id });
  assert.equal((await AUTH_HANDLERS.login(ctx)).statusCode, 400);
  assert.deepEqual(lookups, []);
  assert.deepEqual(calls, []);
});

test('tenant A credentials submitted for tenant B stay in B realm and are rejected', async () => {
  const other = { ...tenant, id: 'tenant-b', slug: 'beta', iam_realm: 'realm-b' };
  const { ctx, calls } = context({ username: 'alice', password: 'example', tenantId: other.id }, other);
  const fetchImpl = ctx._fetch;
  ctx._fetch = async (url, init) => {
    await fetchImpl(url, init);
    return { ok: false, status: 400, async json() { return { error_description: 'Invalid user credentials' }; } };
  };
  const result = await AUTH_HANDLERS.login(ctx);
  assert.equal(result.statusCode, 401);
  assert.match(calls[0].url, /\/realms\/realm-b\/protocol\/openid-connect\/token$/);
  assert.equal(calls[0].form.get('client_id'), 'beta-app');
});

test('tenant refresh and logout use the same resolved target', async () => {
  const { ctx, calls } = context({ refreshToken: 'example-refresh', tenantId: tenant.id });
  assert.equal((await AUTH_HANDLERS.refresh(ctx)).statusCode, 200);
  assert.equal((await AUTH_HANDLERS.logout(ctx)).statusCode, 200);
  assert.match(calls[0].url, /\/realms\/realm%2Fa\/protocol\/openid-connect\/token$/);
  assert.match(calls[1].url, /\/realms\/realm%2Fa\/protocol\/openid-connect\/logout$/);
  assert.equal(calls[0].form.get('client_id'), 'alpha-app');
  assert.equal(calls[1].form.get('client_id'), 'alpha-app');
});

test('refresh after tenant logout rejects the revoked token', async () => {
  const { ctx, calls } = context({ refreshToken: 'example-refresh', tenantId: tenant.id });
  let revoked = false;
  const fetchImpl = ctx._fetch;
  ctx._fetch = async (url, init) => {
    if (url.endsWith('/logout')) revoked = true;
    if (revoked && url.endsWith('/token')) {
      calls.push({ url, form: new URLSearchParams(init.body) });
      return { ok: false, status: 400, async json() { return { error_description: 'Token is not active' }; } };
    }
    return fetchImpl(url, init);
  };
  assert.equal((await AUTH_HANDLERS.logout(ctx)).statusCode, 200);
  const result = await AUTH_HANDLERS.refresh(ctx);
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.code, 'REFRESH_FAILED');
  assert.equal(result.body.tokenSet, undefined);
});
