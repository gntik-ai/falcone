/**
 * Regression: fix-console-logout-revoke-session (#667)
 *
 * Console logout (DELETE /v1/auth/login-sessions/{sessionId}) used to be a no-op:
 * it returned {status:'accepted'} but never revoked the refresh token or ended the
 * Keycloak SSO session, so a logged-out user's pre-logout refresh token kept minting
 * valid access tokens.
 *
 * These tests drive the REAL AUTH_HANDLERS.logout / .refresh against a FAKE Keycloak
 * injected through the ctx._fetch seam (mirrors the ctx._kcAdmin injection used by
 * signup). No live Keycloak / no network.
 *
 * Acceptance criteria encoded:
 *  - logout with a refreshToken MUST POST to Keycloak's
 *    /protocol/openid-connect/logout with client_id + refresh_token (revoke + end SSO).
 *  - after logout, replaying the (now revoked) refresh token at /refresh returns 401
 *    and issues no token.
 *
 * This test FAILS if logout is reverted to the bare accept (no Keycloak call).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTH_HANDLERS } from '../../apps/control-plane/auth-handlers.mjs';

const { logout, refresh } = AUTH_HANDLERS;

// Non-provider placeholder tokens (never use provider-shaped literals).
const SESSION_ID = 'cs_0123456789abcdef0123456789abcdef';
const REFRESH_TOKEN = 'placeholder-refresh-token-0001';

/**
 * Build a fake Keycloak `fetch` that:
 *  - on the logout endpoint: records the form params and revokes the refresh
 *    token (Keycloak returns 204 No Content);
 *  - on the token endpoint with grant_type=refresh_token: returns a fresh token
 *    set UNLESS the refresh token was revoked, in which case it returns the
 *    Keycloak 400 invalid_grant the real server returns for a revoked token.
 */
function makeFakeKeycloak() {
  const state = { revoked: new Set(), logoutCalls: [], tokenCalls: [] };

  async function fakeFetch(url, init = {}) {
    const u = String(url);
    const form = new URLSearchParams(typeof init.body === 'string' ? init.body : (init.body ?? ''));

    if (u.endsWith('/protocol/openid-connect/logout')) {
      state.logoutCalls.push({
        url: u,
        contentType: init.headers?.['content-type'],
        clientId: form.get('client_id'),
        refreshToken: form.get('refresh_token')
      });
      if (form.get('refresh_token')) state.revoked.add(form.get('refresh_token'));
      return { ok: true, status: 204, async json() { return {}; } };
    }

    if (u.endsWith('/protocol/openid-connect/token')) {
      const rt = form.get('refresh_token');
      state.tokenCalls.push({ grantType: form.get('grant_type'), refreshToken: rt });
      if (form.get('grant_type') === 'refresh_token' && state.revoked.has(rt)) {
        return {
          ok: false,
          status: 400,
          async json() { return { error: 'invalid_grant', error_description: 'Token is not active' }; }
        };
      }
      // A valid refresh: minimal token set the handler can shape into a session.
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            access_token: makeFakeJwt(),
            refresh_token: 'rotated-refresh-token',
            expires_in: 300,
            refresh_expires_in: 1800,
            scope: 'openid'
          };
        }
      };
    }

    throw new Error(`unexpected fetch in fake Keycloak: ${u}`);
  }

  return { fakeFetch, state };
}

// Minimal unsigned JWT-shaped string so sessionFromTokenResponse can base64url-decode
// the payload. NOT a real/signed token — placeholder only.
function makeFakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1', preferred_username: 'alice', email: 'alice@example.test', name: 'Alice',
    realm_access: { roles: ['tenant_owner'] }
  })).toString('base64url');
  return `${header}.${payload}.`;
}

function makeCtx({ params = {}, body = {}, fetchImpl } = {}) {
  return { params, query: {}, body, identity: null, callerContext: null, pool: null, _fetch: fetchImpl };
}

// ── lo-01 ─────────────────────────────────────────────────────────────────────
// Logout with a refresh token MUST call Keycloak's logout endpoint with the
// public client_id and the refresh_token (revoke + end SSO session).
test('lo-01: logout revokes the refresh token at Keycloak (client_id + refresh_token)', async () => {
  const { fakeFetch, state } = makeFakeKeycloak();

  const result = await logout(makeCtx({
    params: { sessionId: SESSION_ID },
    body: { refreshToken: REFRESH_TOKEN },
    fetchImpl: fakeFetch
  }));

  // Response shape is unchanged (stable wire): 200 accepted.
  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}`);
  assert.equal(result.body.status, 'accepted');
  assert.equal(result.body.sessionId, SESSION_ID);

  // The revoke MUST actually have been attempted — this is what the no-op missed.
  assert.equal(state.logoutCalls.length, 1, 'logout MUST call Keycloak /protocol/openid-connect/logout exactly once');
  const call = state.logoutCalls[0];
  assert.match(call.url, /\/protocol\/openid-connect\/logout$/);
  assert.equal(call.clientId, 'in-falcone-console', 'logout MUST send the public console client_id');
  assert.equal(call.refreshToken, REFRESH_TOKEN, 'logout MUST send the session refresh_token to revoke');
  assert.match(String(call.contentType ?? ''), /application\/x-www-form-urlencoded/);
});

// ── lo-02 ─────────────────────────────────────────────────────────────────────
// After logout, replaying the pre-logout refresh token at /refresh is rejected
// (401, no token issued). This is the end-to-end "Refresh after logout" scenario.
test('lo-02: refresh after logout is rejected (401, no token issued)', async () => {
  const { fakeFetch, state } = makeFakeKeycloak();

  // Sanity: BEFORE logout the refresh token still works (200 + a token set).
  const before = await refresh(makeCtx({
    params: { sessionId: SESSION_ID }, body: { refreshToken: REFRESH_TOKEN }, fetchImpl: fakeFetch
  }));
  assert.equal(before.statusCode, 200, 'pre-logout refresh should succeed');
  assert.ok(before.body?.tokenSet?.accessToken, 'pre-logout refresh should mint an access token');

  // Log out (revokes REFRESH_TOKEN at the fake Keycloak).
  await logout(makeCtx({
    params: { sessionId: SESSION_ID }, body: { refreshToken: REFRESH_TOKEN }, fetchImpl: fakeFetch
  }));
  assert.ok(state.revoked.has(REFRESH_TOKEN), 'logout must have revoked the refresh token');

  // Replay the SAME (pre-logout) refresh token: now rejected.
  const after = await refresh(makeCtx({
    params: { sessionId: SESSION_ID }, body: { refreshToken: REFRESH_TOKEN }, fetchImpl: fakeFetch
  }));
  assert.equal(after.statusCode, 401, `refresh after logout MUST be 401, got ${after.statusCode}`);
  assert.equal(after.body?.code, 'REFRESH_FAILED');
  assert.equal(after.body?.tokenSet, undefined, 'refresh after logout MUST NOT issue a token set');
  assert.equal(after.body?.accessToken, undefined, 'refresh after logout MUST NOT issue an access token');
});

// ── lo-03 ─────────────────────────────────────────────────────────────────────
// Backward compatible: an older client that omits the refresh token still gets a
// clean accept (no 500, no Keycloak call).
test('lo-03: logout without a refresh token still accepts (no 500, no Keycloak call)', async () => {
  const { fakeFetch, state } = makeFakeKeycloak();

  const result = await logout(makeCtx({
    params: { sessionId: SESSION_ID }, body: {}, fetchImpl: fakeFetch
  }));

  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}`);
  assert.equal(result.body.status, 'accepted');
  assert.equal(state.logoutCalls.length, 0, 'no Keycloak logout call without a refresh token');
});
