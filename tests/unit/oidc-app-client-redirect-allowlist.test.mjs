/**
 * Regression: fix-oidc-app-client-redirect-allowlist (#670)
 *
 * Per-tenant public OIDC app clients (`<slug>-app`) were provisioned with
 * `redirectUris: ['*'], webOrigins: ['*']`, the authorization-code flow enabled, and NO PKCE.
 * The Keycloak authorization endpoint therefore accepted an arbitrary attacker-controlled
 * `redirect_uri` (a classic auth-code interception vector: a victim's auth code can be
 * delivered to an attacker callback).
 *
 * These tests drive the REAL `kcAdmin.createPublicAppClient` (apps/control-plane/kc-admin.mjs)
 * against a FAKE Keycloak injected through `globalThis.fetch` (mirrors the fetch-seam harness used by
 * console-logout-revoke-session / sa-revocation unit tests). No live Keycloak / no network.
 *
 * Acceptance criteria encoded (the issue's MODIFIED requirement + scenarios):
 *  - the provisioned app client's `redirectUris` is the configured allow-list and is NEVER `['*']`
 *    (the differential that FAILS on the pre-fix wildcard default → "Foreign redirect_uri rejected"
 *    is only possible once KC has a non-wildcard allow-list);
 *  - `webOrigins` is the configured value and is NEVER `['*']`;
 *  - PKCE is enabled: `attributes['pkce.code.challenge.method'] === 'S256'`;
 *  - the public-client flags are unchanged (publicClient / standardFlowEnabled /
 *    directAccessGrantsEnabled all true) so ROPC (the campaign's direct grant) keeps working;
 *  - an explicit `redirectUris`/`webOrigins` passed by a caller is honored (allow-listed accepted).
 *  - the env-driven allow-list (TENANT_APP_REDIRECT_URIS / TENANT_APP_WEB_ORIGINS) is parsed,
 *    wildcard entries are stripped, and a non-wildcard fallback is used when unset.
 *
 * This test FAILS if createPublicAppClient is reverted to `redirectUris=['*'], webOrigins=['*']`
 * with no PKCE attribute.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { kcAdmin, parseAllowList } from '../../apps/control-plane/kc-admin.mjs';

const REALM = 'ten-acme';

/**
 * Build a fake Keycloak `fetch` that:
 *  - answers the master-realm admin token POST with {access_token, expires_in};
 *  - captures the JSON body POSTed to `.../clients` and returns 201 + a Location header
 *    (mirrors Keycloak's create-client response: 201, empty body, id in Location).
 * Returns { fetchImpl, captured } where captured.clientBody is the parsed client payload.
 */
function makeFakeKeycloak() {
  const captured = { tokenCalls: 0, clientBody: null, clientPath: null };

  async function fetchImpl(url, init = {}) {
    const u = String(url);

    if (u.endsWith('/realms/master/protocol/openid-connect/token')) {
      captured.tokenCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        async text() { return JSON.stringify({ access_token: 'fake-admin-token', expires_in: 60 }); },
        async json() { return { access_token: 'fake-admin-token', expires_in: 60 }; },
      };
    }

    if (/\/admin\/realms\/[^/]+\/clients$/.test(u) && (init.method ?? 'GET') === 'POST') {
      captured.clientPath = u;
      captured.clientBody = JSON.parse(init.body);
      // Keycloak: 201 Created, no body, id in the Location header.
      return {
        ok: true,
        status: 201,
        headers: new Headers({ location: `${u}/00000000-aaaa-bbbb-cccc-000000000001` }),
        async text() { return ''; },
        async json() { return null; },
      };
    }

    throw new Error(`unexpected fetch in fake Keycloak: ${init.method ?? 'GET'} ${u}`);
  }

  return { fetchImpl, captured };
}

// Swap globalThis.fetch around each test so the module-level `fetch` calls hit the fake.
let realFetch;
test.beforeEach(() => { realFetch = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = realFetch; });

// ── ca-01 ───────────────────────────────────────────────────────────────────
// The created app client NEVER carries a wildcard redirect/web-origin allow-list, and PKCE is on.
// This is the core differential: it FAILS on the pre-fix `['*']` default.
test('ca-01: app client uses a NON-wildcard allow-list and PKCE S256', async () => {
  const { fetchImpl, captured } = makeFakeKeycloak();
  globalThis.fetch = fetchImpl;

  const uuid = await kcAdmin.createPublicAppClient(REALM, { clientId: 'acme-app', name: 'Acme App' });
  assert.equal(uuid, '00000000-aaaa-bbbb-cccc-000000000001', 'returns the created client UUID from Location');

  const body = captured.clientBody;
  assert.ok(body, 'a client POST body was captured');

  // The cardinal assertion: redirectUris / webOrigins are NEVER the wildcard.
  assert.notDeepEqual(body.redirectUris, ['*'], 'redirectUris MUST NOT be the wildcard ["*"]');
  assert.notDeepEqual(body.webOrigins, ['*'], 'webOrigins MUST NOT be the wildcard ["*"]');
  assert.ok(Array.isArray(body.redirectUris) && body.redirectUris.length > 0, 'redirectUris is a non-empty allow-list');
  assert.ok(!body.redirectUris.includes('*'), 'no wildcard entry in redirectUris');
  assert.ok(!body.webOrigins.includes('*'), 'no wildcard entry in webOrigins');

  // PKCE (S256) MUST be enabled on the public client (auth-code hardening).
  assert.equal(body.attributes?.['pkce.code.challenge.method'], 'S256', 'PKCE S256 attribute must be set');
  // The existing kind marker attribute is preserved.
  assert.equal(body.attributes?.['in-falcone.kind'], 'tenant-app');
});

// ── ca-02 ───────────────────────────────────────────────────────────────────
// Public-client flags are unchanged: ROPC (direct grant) + the standard (auth-code) flow stay on,
// it is still a public client, and it is NOT a service account. PKCE only affects auth-code, not ROPC.
test('ca-02: public-client flags unchanged (publicClient / standardFlow / directAccessGrants all true)', async () => {
  const { fetchImpl, captured } = makeFakeKeycloak();
  globalThis.fetch = fetchImpl;

  await kcAdmin.createPublicAppClient(REALM, { clientId: 'acme-app', name: 'Acme App' });
  const body = captured.clientBody;

  assert.equal(body.publicClient, true, 'still a public client');
  assert.equal(body.standardFlowEnabled, true, 'auth-code flow still enabled');
  assert.equal(body.directAccessGrantsEnabled, true, 'ROPC (direct grant) still enabled — the campaign relies on it');
  assert.equal(body.serviceAccountsEnabled, false, 'still not a service account');
  assert.equal(body.protocol, 'openid-connect');
  assert.equal(body.enabled, true);
});

// ── ca-03 ───────────────────────────────────────────────────────────────────
// "Allow-listed redirect_uri accepted": an explicit allow-list passed by a caller passes through
// verbatim (the parameter contract is preserved), and is still never a wildcard.
test('ca-03: explicit redirectUris/webOrigins are honored (pass-through)', async () => {
  const { fetchImpl, captured } = makeFakeKeycloak();
  globalThis.fetch = fetchImpl;

  const redirectUris = ['https://app.acme.example/callback', 'https://app.acme.example/silent-renew'];
  const webOrigins = ['https://app.acme.example'];
  await kcAdmin.createPublicAppClient(REALM, { clientId: 'acme-app', name: 'Acme App', redirectUris, webOrigins });

  const body = captured.clientBody;
  assert.deepEqual(body.redirectUris, redirectUris, 'caller-supplied redirectUris are used verbatim');
  assert.deepEqual(body.webOrigins, webOrigins, 'caller-supplied webOrigins are used verbatim');
  assert.equal(body.attributes?.['pkce.code.challenge.method'], 'S256', 'PKCE still enforced for explicit allow-lists');
});

// ── ca-04 ───────────────────────────────────────────────────────────────────
// The env-driven allow-list parser: comma-separated, trimmed, wildcard entries stripped, and a
// NON-wildcard fallback when unset/empty. Proves TENANT_APP_REDIRECT_URIS / TENANT_APP_WEB_ORIGINS
// are honored deterministically (no module re-import / no env mutation race).
test('ca-04: parseAllowList honors a configured list, strips wildcards, falls back non-wildcard', () => {
  const fallback = ['https://app.in-falcone.example.com/*'];

  // A configured comma-separated list is parsed and trimmed.
  assert.deepEqual(
    parseAllowList('https://a.example/*, http://localhost:8088/* ', fallback),
    ['https://a.example/*', 'http://localhost:8088/*'],
  );

  // Wildcard entries are dropped — a list of only `*` collapses to the (non-wildcard) fallback.
  assert.deepEqual(parseAllowList('*', fallback), fallback, 'a lone wildcard is rejected → fallback');
  assert.deepEqual(
    parseAllowList('*,https://ok.example/*', fallback),
    ['https://ok.example/*'],
    'a wildcard mixed with a real URI keeps only the real URI',
  );

  // Unset / empty → the non-wildcard fallback (NEVER ['*']).
  assert.deepEqual(parseAllowList(undefined, fallback), fallback);
  assert.deepEqual(parseAllowList('', fallback), fallback);
  assert.deepEqual(parseAllowList('   ', fallback), fallback);
  assert.ok(!parseAllowList(undefined, fallback).includes('*'), 'fallback is never a wildcard');

  // The `+` web-origin idiom is a valid (non-wildcard) entry and is preserved.
  assert.deepEqual(parseAllowList('+', ['+']), ['+']);
});
