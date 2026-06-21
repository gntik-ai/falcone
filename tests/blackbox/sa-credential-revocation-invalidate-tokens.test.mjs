/**
 * Black-box tests for fix-sa-credential-revocation-invalidate-tokens (GitHub issue #684, P16/P7/P17).
 *
 * Defect: revoking (or rotating) a service-account credential disabled the Keycloak client +
 * regenerated the secret + (revoke) flipped PG status='revoked', but the JWT verifier validated
 * OFFLINE only (signature + exp/nbf + issuer + audience), so an access token already minted from
 * that credential kept being accepted until its natural ~300s expiry.
 *
 * Fix: revoke AND rotate now stamp service_accounts.credentials_invalidated_at = NOW(); the verifier
 * runs an injected, DB-backed, SA-only `revocationCheck(claims)` AFTER offline validation and rejects
 * (401, message "credential revoked") a SA token whose credential was revoked / whose iat predates
 * the cutoff. Non-SA (user/owner) tokens are untouched.
 *
 * This suite drives the PUBLIC surfaces deterministically (no DB, no Keycloak):
 *   bbx-684-01  revokeCredential sets the revocation cutoff (Scenario 1)
 *   bbx-684-02  rotateCredential sets the revocation cutoff (Scenario 2) — previously touched no row
 *   bbx-684-03  the verifier rejects a token when revocationCheck returns true (→ 401 path)
 *   bbx-684-04  the verifier with the DEFAULT (no) hook is unchanged (back-compat)
 *   bbx-684-05  the verifier's revocationCheck only fires after offline validation passes
 *   bbx-684-06  revoke/rotate still return their existing response shapes (contract unchanged)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';
import { createMultiRealmVerifier, deriveRealmTopology } from '../../deploy/kind/control-plane/jwt-verify.mjs';
import { createSaRevocationCheck } from '../../deploy/kind/control-plane/sa-revocation.mjs';

// ---- handler harness: inject store + kcAdmin via ctx ----------------------
function handlerCtx(overrides = {}) {
  const calls = { markInvalidated: [], setStatus: [], regenerate: [], setEnabled: [] };
  const sa = { id: 'sa-uuid-1', workspace_id: 'ws-1', tenant_id: 'ten-1', iam_realm: 'ten-1', kc_client_id: 'sa-acme-repro', kc_client_uuid: 'kc-uuid-1' };
  const store = {
    async getWorkspace() { return { id: 'ws-1', tenant_id: 'ten-1', slug: 'acme' }; },
    async getTenant() { return { id: 'ten-1', iam_realm: 'ten-1' }; },
    async getServiceAccount() { return sa; },
    async setServiceAccountStatus(_p, id, status) { calls.setStatus.push([id, status]); },
    async markServiceAccountCredentialsInvalidated(_p, id) { calls.markInvalidated.push(id); },
    ...overrides.store,
  };
  const kcAdmin = {
    base: 'http://kc',
    async regenerateClientSecret(realm, uuid) { calls.regenerate.push([realm, uuid]); return 'new-secret'; },
    async setClientEnabled(realm, uuid, enabled) { calls.setEnabled.push([realm, uuid, enabled]); },
    async getClientSecret() { return 'current-secret'; },
    ...overrides.kcAdmin,
  };
  return {
    calls, sa,
    ctx: {
      pool: {}, store, kcAdmin,
      identity: { sub: 'owner-1', actorType: 'tenant_owner', tenantId: 'ten-1' },
      params: { workspaceId: 'ws-1', serviceAccountId: 'sa-uuid-1' },
      body: {},
    },
  };
}

test('bbx-684-01: revokeCredential stamps credentials_invalidated_at (Scenario 1)', async () => {
  const h = handlerCtx();
  const res = await LOCAL_HANDLERS.revokeCredential(h.ctx);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'revoked');
  assert.deepEqual(h.calls.setStatus, [['sa-uuid-1', 'revoked']], 'still flips PG status');
  assert.deepEqual(h.calls.markInvalidated, ['sa-uuid-1'], 'sets the revocation cutoff for in-flight tokens');
  assert.deepEqual(h.calls.setEnabled, [['ten-1', 'kc-uuid-1', false]], 'still disables the KC client');
  assert.equal(h.calls.regenerate.length, 1, 'still regenerates the secret (blocks new grants)');
});

test('bbx-684-02: rotateCredential stamps credentials_invalidated_at (Scenario 2)', async () => {
  const h = handlerCtx();
  const res = await LOCAL_HANDLERS.rotateCredential(h.ctx);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.clientSecret, 'new-secret');
  assert.deepEqual(h.calls.regenerate, [['ten-1', 'kc-uuid-1']], 'still regenerates the secret');
  assert.deepEqual(h.calls.markInvalidated, ['sa-uuid-1'],
    'rotation now cuts off pre-rotation tokens (previously this handler wrote NO row)');
});

test('bbx-684-06: revoke/rotate keep their existing response contract (no shape change)', async () => {
  const rev = await LOCAL_HANDLERS.revokeCredential(handlerCtx().ctx);
  assert.deepEqual(Object.keys(rev.body).sort(), ['revokedAt', 'serviceAccountId', 'status']);
  const rot = await LOCAL_HANDLERS.rotateCredential(handlerCtx().ctx);
  // Same keys as before the fix: credentialId, secret, expiresAt, clientId, clientSecret, rotatedAt.
  assert.deepEqual(Object.keys(rot.body).sort(),
    ['clientId', 'clientSecret', 'credentialId', 'expiresAt', 'rotatedAt', 'secret']);
});

// ---- verifier hook integration --------------------------------------------
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const BASE = 'http://kc/realms/';
const PLATFORM = 'in-falcone-platform';
const JWKS_URL = `${BASE}${PLATFORM}/protocol/openid-connect/certs`;
const ISSUER = `${BASE}${PLATFORM}`;
const NOW = 1_900_000_000_000;
const tNow = Math.floor(NOW / 1000);
const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
function sign(payload) {
  const head = b64url({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const saToken = sign({ sub: 'sa', iss: ISSUER, aud: 'in-falcone', azp: 'sa-acme-repro', iat: tNow - 10, exp: tNow + 600 });

test('bbx-684-03: a verifier with revocationCheck→true rejects an otherwise-valid token (401 path)', async () => {
  const v = createMultiRealmVerifier({
    jwksUrl: JWKS_URL, issuer: ISSUER, audience: 'in-falcone', fetchImpl, now: () => NOW,
    revocationCheck: async (claims) => claims.azp === 'sa-acme-repro', // revoked
  });
  await assert.rejects(v.verify(saToken), /credential revoked/);
});

test('bbx-684-04: the DEFAULT verifier (no hook) accepts the same token (back-compat)', async () => {
  const v = createMultiRealmVerifier({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: 'in-falcone', fetchImpl, now: () => NOW });
  const { payload, trust } = await v.verify(saToken);
  assert.equal(trust.kind, 'platform');
  assert.equal(payload.azp, 'sa-acme-repro');
});

test('bbx-684-04b: revocationCheck→false leaves the token accepted', async () => {
  let saw = null;
  const v = createMultiRealmVerifier({
    jwksUrl: JWKS_URL, issuer: ISSUER, audience: 'in-falcone', fetchImpl, now: () => NOW,
    revocationCheck: async (claims) => { saw = claims.azp; return false; },
  });
  const { payload } = await v.verify(saToken);
  assert.equal(payload.sub, 'sa');
  assert.equal(saw, 'sa-acme-repro', 'the hook receives the verified claims');
});

test('bbx-684-05: revocationCheck does NOT run for a token that fails offline validation', async () => {
  let called = false;
  const v = createMultiRealmVerifier({
    jwksUrl: JWKS_URL, issuer: ISSUER, audience: 'in-falcone', fetchImpl, now: () => NOW,
    revocationCheck: async () => { called = true; return true; },
  });
  // Expired token: offline validation throws BEFORE the revocation hook would run.
  const expired = sign({ sub: 'sa', iss: ISSUER, aud: 'in-falcone', azp: 'sa-acme-repro', iat: tNow - 4000, exp: tNow - 3600 });
  await assert.rejects(v.verify(expired), /expired/);
  assert.equal(called, false, 'the revocation hook must run only after offline validation passes');
});

// ---- end-to-end: REAL revocation check wired into the verifier (realm-scoped) ----------------------
// Boundary test: the verifier derives the realm from the cryptographically-verified issuer and threads
// it to the production createSaRevocationCheck, backed by a fake store keyed on (realm, clientId). This
// exercises the BLOCKING #1 fix (cross-tenant kc_client_id collision) through the real verifier path.
const { realmsBase, platformRealm } = deriveRealmTopology(ISSUER, JWKS_URL);
const REALM_A = 'ten-a';
const REALM_B = 'ten-b';
const COLLIDING_SA = 'sa-acme-repro'; // both tenants own a SA with this exact client id
const tenantToken = (realm, iat = tNow - 10) =>
  sign({ sub: 'sa', iss: `${realmsBase}${realm}`, azp: COLLIDING_SA, iat, exp: tNow + 600 });
// Store fake: realm A's colliding SA is REVOKED, realm B's is ACTIVE.
const collisionStore = {
  calls: [],
  async getServiceAccountAuthStateByClientId(_pool, clientId, realm) {
    this.calls.push([clientId, realm]);
    if (clientId === COLLIDING_SA && realm === REALM_A) return { status: 'revoked', credentials_invalidated_at: new Date(NOW) };
    if (clientId === COLLIDING_SA && realm === REALM_B) return { status: 'active', credentials_invalidated_at: null };
    return null;
  },
};

test('bbx-684-07: revoked tenant-realm SA token is rejected via the REAL check (Scenario 1, realm-scoped)', async () => {
  collisionStore.calls.length = 0;
  const v = createMultiRealmVerifier({
    jwksUrl: JWKS_URL, issuer: ISSUER, fetchImpl, now: () => NOW,
    revocationCheck: createSaRevocationCheck({ pool: {}, store: collisionStore, realmsBase, platformRealm, cacheMs: 0, now: () => NOW }),
  });
  await assert.rejects(v.verify(tenantToken(REALM_A)), /credential revoked/);
  assert.deepEqual(collisionStore.calls, [[COLLIDING_SA, REALM_A]], 'looked up with the verified realm A');
});

test('bbx-684-08: cross-tenant collision — realm-A revoke does NOT reject realm-B token with the SAME client id', async () => {
  collisionStore.calls.length = 0;
  const v = createMultiRealmVerifier({
    jwksUrl: JWKS_URL, issuer: ISSUER, fetchImpl, now: () => NOW,
    revocationCheck: createSaRevocationCheck({ pool: {}, store: collisionStore, realmsBase, platformRealm, cacheMs: 0, now: () => NOW }),
  });
  // Realm B's token (same client id as the revoked realm-A SA) must verify — no cross-tenant 401.
  const identityB = await v.verify(tenantToken(REALM_B));
  assert.equal(identityB.trust.kind, 'tenant');
  assert.equal(identityB.trust.realm, REALM_B);
  assert.deepEqual(collisionStore.calls, [[COLLIDING_SA, REALM_B]], 'looked up with realm B, not an arbitrary tenant');
});
