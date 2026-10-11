/**
 * Black-box tests for fix-sa-credential-issuance-honor-revocation (GitHub issue #685, P16 credential lifecycle).
 *
 * Defect: after a service account is REVOKED (service_accounts.status='revoked', Keycloak client
 * disabled via revokeCredential), calling credential-issuance or credential-rotations on it STILL
 * returned HTTP 201 with a fresh clientSecret — a misleading success that hands back a secret that
 * can never obtain a token (client_credentials grant → 401 invalid_client). Revocation itself was not
 * bypassed; only the response was misleading.
 *
 * Fix: issueCredential and rotateCredential now guard on the SA's status BEFORE touching Keycloak and
 * reject a revoked SA with 409 CREDENTIAL_REVOKED, carrying NO secret. The guard lives ONLY in those
 * two handlers — revokeCredential stays idempotent (re-revoking a revoked SA still returns 200, never
 * 409). The active-SA paths are byte-identical to before (201 with clientSecret; rotate still stamps
 * markServiceAccountCredentialsInvalidated per #684).
 *
 * This suite drives the PUBLIC handler surface deterministically (no DB, no Keycloak):
 *   bbx-685-01  issueCredential on a revoked SA → 409 CREDENTIAL_REVOKED, no secret, KC NOT called (Scenario)
 *   bbx-685-02  rotateCredential on a revoked SA → 409 CREDENTIAL_REVOKED, no secret, KC/stamp NOT called (Scenario)
 *   bbx-685-03  issueCredential on an active SA → still 201 with clientSecret (regression: behavior unchanged)
 *   bbx-685-04  rotateCredential on an active SA → still 201 with clientSecret + stamps invalidation (#684 regression)
 *   bbx-685-05  revokeCredential on an already-revoked SA stays idempotent (200, no 409) — guard did not leak into revoke
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { kcAdmin } from '../../apps/control-plane/kc-admin.mjs';

// ---- handler harness: inject store + kcAdmin via ctx, parameterized by SA status -----------------
function handlerCtx({ status = 'active' } = {}) {
  const calls = {
    getClientSecret: [], regenerate: [], setEnabled: [], setStatus: [], markInvalidated: [],
  };
  const sa = {
    id: 'sa-uuid-1', workspace_id: 'ws-1', tenant_id: 'ten-1', iam_realm: 'ten-1',
    kc_client_id: 'sa-acme-repro', kc_client_uuid: 'kc-uuid-1', status,
  };
  const store = {
    async getWorkspace() { return { id: 'ws-1', tenant_id: 'ten-1', slug: 'acme' }; },
    async getTenant() { return { id: 'ten-1', iam_realm: 'ten-1' }; },
    async getServiceAccount() { return sa; },
    async setServiceAccountStatus(_p, id, s) { calls.setStatus.push([id, s]); },
    async markServiceAccountCredentialsInvalidated(_p, id) { calls.markInvalidated.push(id); },
  };
  const kcAdmin = {
    base: 'http://kc',
    async getClientSecret(realm, uuid) { calls.getClientSecret.push([realm, uuid]); return 'current-secret'; },
    async regenerateClientSecret(realm, uuid) { calls.regenerate.push([realm, uuid]); return 'new-secret'; },
    async setClientEnabled(realm, uuid, enabled) { calls.setEnabled.push([realm, uuid, enabled]); },
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

// A response body must never carry a usable secret. Both the kind CP shape ({secret, clientSecret})
// and any envelope-ish nesting are covered by scanning the serialized body for either key.
function bodyHasSecret(body) {
  return body != null && (body.secret !== undefined || body.clientSecret !== undefined);
}

test('bbx-685-01: issueCredential on a revoked SA returns 409 CREDENTIAL_REVOKED with no secret (Scenario)', async () => {
  const h = handlerCtx({ status: 'revoked' });
  const res = await LOCAL_HANDLERS.issueCredential(h.ctx, { KEYCLOAK_ISSUER: 'https://iam.example/realms/platform' });
  assert.equal(res.statusCode, 409, 'rejects with conflict instead of a misleading 201');
  assert.equal(res.body.code, 'CREDENTIAL_REVOKED');
  assert.equal(bodyHasSecret(res.body), false, 'no clientSecret/secret is handed back for a revoked SA');
  assert.deepEqual(h.calls.getClientSecret, [], 'Keycloak getClientSecret is not called (guard runs first)');
});

test('bbx-685-02: rotateCredential on a revoked SA returns 409 CREDENTIAL_REVOKED, KC + invalidation stamp NOT called (Scenario)', async () => {
  const h = handlerCtx({ status: 'revoked' });
  const res = await LOCAL_HANDLERS.rotateCredential(h.ctx);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CREDENTIAL_REVOKED');
  assert.equal(bodyHasSecret(res.body), false, 'no secret is handed back for a revoked SA');
  assert.deepEqual(h.calls.regenerate, [], 'Keycloak regenerateClientSecret is not called');
  assert.deepEqual(h.calls.markInvalidated, [], 'no revocation-cutoff stamp is written for the rejected rotate');
});

test('bbx-685-03: issueCredential on an active SA still returns 201 with a clientSecret (regression)', async () => {
  const h = handlerCtx({ status: 'active' });
  const res = await LOCAL_HANDLERS.issueCredential(h.ctx, {});
  assert.equal(res.statusCode, 201, 'active SA path unchanged');
  assert.equal(res.body.clientSecret, 'current-secret');
  assert.equal(res.body.secret, 'current-secret');
  assert.equal(res.body.grantType, 'client_credentials');
  assert.deepEqual(h.calls.getClientSecret, [['ten-1', 'kc-uuid-1']], 'still fetches the live secret for an active SA');
});

test('#959: issued credentials use the public issuer and the service account tenant realm', async () => {
  const h = handlerCtx();
  const res = await LOCAL_HANDLERS.issueCredential(h.ctx, { KEYCLOAK_ISSUER: 'https://iam.example/realms/platform' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.tokenEndpoint, 'https://iam.example/realms/ten-1/protocol/openid-connect/token');
  assert.ok(!res.body.tokenEndpoint.includes(h.ctx.kcAdmin.base));
  assert.equal(res.body.credentialId, 'sa-acme-repro');
  assert.equal(res.body.clientId, 'sa-acme-repro');
  assert.equal(res.body.secret, 'current-secret');
  assert.equal(res.body.clientSecret, 'current-secret');
  assert.equal(res.body.grantType, 'client_credentials');
  assert.equal(res.body.expiresAt, null);
  assert.ok(Number.isFinite(Date.parse(res.body.issuedAt)));
  assert.deepEqual(h.calls.getClientSecret, [['ten-1', 'kc-uuid-1']]);
});

test('#959: issuance preserves issuer prefixes and encodes the service account realm', async () => {
  const h = handlerCtx();
  h.sa.iam_realm = 'tenant realm/one';
  for (const issuer of ['https://iam.example/auth/realms/platform', 'https://iam.example/auth/realms/platform/']) {
    const res = await LOCAL_HANDLERS.issueCredential(h.ctx, { KEYCLOAK_ISSUER: issuer });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.tokenEndpoint, 'https://iam.example/auth/realms/tenant%20realm%2Fone/protocol/openid-connect/token');
  }
});

test('#959: invalid public issuers keep the internal-only string fallback', async () => {
  for (const issuer of [undefined, '', 'not-a-url', 'ftp://iam.example/realms/platform',
    'https://user:password@iam.example/realms/platform', 'https://iam.example/auth']) {
    const h = handlerCtx();
    const res = await LOCAL_HANDLERS.issueCredential(h.ctx, { KEYCLOAK_ISSUER: issuer });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.tokenEndpoint, 'http://kc/realms/ten-1/protocol/openid-connect/token');
    assert.deepEqual(h.calls.getClientSecret, [['ten-1', 'kc-uuid-1']]);
  }
});

test('#959: the public response endpoint leaves real Keycloak admin traffic on its internal base', async (t) => {
  const h = handlerCtx();
  h.ctx.kcAdmin = kcAdmin;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    assert.ok(String(url).startsWith(`${kcAdmin.base}/`));
    if (String(url).endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    assert.equal(String(url), `${kcAdmin.base}/admin/realms/ten-1/clients/kc-uuid-1/client-secret`);
    return Response.json({ value: 'current-secret' });
  });
  const res = await LOCAL_HANDLERS.issueCredential(h.ctx, { KEYCLOAK_ISSUER: 'https://iam.example/realms/platform' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.tokenEndpoint, 'https://iam.example/realms/ten-1/protocol/openid-connect/token');
  assert.equal(res.body.clientSecret, 'current-secret');
  assert.deepEqual(requests, [
    `${kcAdmin.base}/realms/master/protocol/openid-connect/token`,
    `${kcAdmin.base}/admin/realms/ten-1/clients/kc-uuid-1/client-secret`,
  ]);
});

test('bbx-685-04: rotateCredential on an active SA still returns 201 with a clientSecret and stamps invalidation (#684 regression)', async () => {
  const h = handlerCtx({ status: 'active' });
  const res = await LOCAL_HANDLERS.rotateCredential(h.ctx);
  assert.equal(res.statusCode, 201, 'active SA path unchanged');
  assert.equal(res.body.clientSecret, 'new-secret');
  assert.equal(res.body.secret, 'new-secret');
  assert.deepEqual(h.calls.regenerate, [['ten-1', 'kc-uuid-1']], 'still regenerates the secret for an active SA');
  assert.deepEqual(h.calls.markInvalidated, ['sa-uuid-1'], 'still cuts off pre-rotation tokens (#684)');
});

test('bbx-685-05: revokeCredential on an already-revoked SA stays idempotent (200, no 409) — guard did not leak into revoke', async () => {
  const h = handlerCtx({ status: 'revoked' });
  const res = await LOCAL_HANDLERS.revokeCredential(h.ctx);
  assert.equal(res.statusCode, 200, 're-revoking a revoked SA must not 409');
  assert.equal(res.body.status, 'revoked');
  assert.deepEqual(h.calls.setStatus, [['sa-uuid-1', 'revoked']], 'still flips PG status (idempotent)');
  assert.deepEqual(h.calls.setEnabled, [['ten-1', 'kc-uuid-1', false]], 'still disables the KC client (idempotent)');
  assert.equal(h.calls.regenerate.length, 1, 'still regenerates the secret (idempotent)');
});
