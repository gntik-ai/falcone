/**
 * Black-box test suite for spec change fix-kind-control-plane-multirealm-jwt
 * (live E2E campaign, GitHub issue #622).
 *
 * Drives the PUBLIC verifier surface of the kind control-plane runtime — the dependency-free
 * (node:crypto) multi-realm JWT verifier the server uses to authenticate control-plane-served
 * routes. Tokens are minted locally (RS256) and JWKS is served via an injected fetch stub keyed by
 * realm certs URL, so no Keycloak / network is needed.
 *
 * Defect: apps/control-plane/server.mjs verified Bearer JWTs against a SINGLE platform-realm
 * JWKS, so a per-tenant-realm token (Falcone places each tenant in its own realm) failed with
 * JWKSNoMatchingKey → 401 INVALID_TOKEN — even though the executor accepted the same token. Fix:
 * trust any realm under the Keycloak base, fetch each realm's JWKS on demand, and take the tenant id
 * from the cryptographically-verified issuer (the realm name).
 *
 * Scenario coverage (capability: control-plane-runtime / spec.md):
 *   bbx-622-01  deriveRealmTopology derives the realms base + platform realm from the JWKS URL
 *   bbx-622-02  a platform-realm token verifies (trust=platform)
 *   bbx-622-03  a per-tenant-realm token verifies; tenant id comes from the verified issuer
 *   bbx-622-04  a forged tenant_id claim cannot override the issuer-derived tenant
 *   bbx-622-05  the tenant realm's JWKS is fetched on demand (not only the platform realm)
 *   bbx-622-06  an issuer outside the trusted Keycloak base is rejected
 *   bbx-622-07  a tenant-realm iss signed with the platform key is rejected (issuer is crypto-bound)
 *   bbx-622-08  alg:none and a tampered signature are rejected
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createMultiRealmVerifier,
  deriveRealmTopology,
} from '../../apps/control-plane/jwt-verify.mjs';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const BASE = 'http://falcone-keycloak:8080/realms/';
const PLATFORM = 'in-falcone-platform';
const JWKS_URL = `${BASE}${PLATFORM}/protocol/openid-connect/certs`;
const PLATFORM_ISSUER = `${BASE}${PLATFORM}`;
const TENANT = 'ten-acme';
const TENANT_ISSUER = `${BASE}${TENANT}`;
const TENANT_CERTS = `${TENANT_ISSUER}/protocol/openid-connect/certs`;

// Distinct signing keys per realm so "wrong realm's key" genuinely fails.
function keypair(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, publicKey, jwk };
}
const platformKey = keypair('platform-key');
const tenantKey = keypair('tenant-key');

function sign(privateKey, payload, { kid } = {}) {
  const head = b64url({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const NOW = 1_900_000_000_000;
const tNow = Math.floor(NOW / 1000);
const baseClaims = (over = {}) => ({
  sub: 'user-1', exp: tNow + 600, realm_access: { roles: ['tenant_owner'] },
  scope: 'data:read', ...over,
});

// JWKS stub: serve each realm's keys at its own certs URL; count fetches per URL.
const fetchCounts = {};
const jwksByUrl = {
  [JWKS_URL]: { keys: [platformKey.jwk] },
  [TENANT_CERTS]: { keys: [tenantKey.jwk] },
};
const fetchImpl = async (url) => {
  const key = String(url);
  fetchCounts[key] = (fetchCounts[key] ?? 0) + 1;
  const body = jwksByUrl[key];
  return body
    ? { ok: true, json: async () => body }
    : { ok: false, status: 404, json: async () => ({ keys: [] }) };
};

function makeVerifier() {
  return createMultiRealmVerifier({
    jwksUrl: JWKS_URL,
    issuer: PLATFORM_ISSUER,
    audience: 'in-falcone',
    fetchImpl,
    now: () => NOW,
  });
}

test('bbx-622-01 deriveRealmTopology derives the realms base + platform realm', () => {
  const t = deriveRealmTopology(PLATFORM_ISSUER, JWKS_URL);
  assert.equal(t.realmsBase, BASE);
  assert.equal(t.platformRealm, PLATFORM);
});

test('bbx-622-02 a platform-realm token verifies (trust=platform)', async () => {
  const v = makeVerifier();
  const { payload, trust } = await v.verify(
    sign(platformKey.privateKey, baseClaims({ iss: PLATFORM_ISSUER, aud: 'in-falcone', tenant_id: 'plat-ten' }), { kid: 'platform-key' }),
  );
  assert.equal(trust.kind, 'platform');
  assert.equal(payload.sub, 'user-1');
});

test('bbx-622-03 a per-tenant-realm token verifies; tenant id from the verified issuer', async () => {
  const v = makeVerifier();
  const { trust } = await v.verify(
    sign(tenantKey.privateKey, baseClaims({ iss: TENANT_ISSUER }), { kid: 'tenant-key' }),
  );
  assert.equal(trust.kind, 'tenant');
  assert.equal(trust.realm, TENANT, 'tenant id is the realm name from the verified issuer');
});

test('bbx-622-04 a forged tenant_id claim cannot override the issuer-derived tenant', async () => {
  const v = makeVerifier();
  // tenant-A realm token that lies: tenant_id=victim. The realm (issuer) is crypto-bound, so the
  // issuer-derived tenant wins — a tenant-A token can never act as another tenant.
  const { trust, payload } = await v.verify(
    sign(tenantKey.privateKey, baseClaims({ iss: TENANT_ISSUER, tenant_id: 'victim' }), { kid: 'tenant-key' }),
  );
  assert.equal(trust.realm, TENANT);
  assert.equal(payload.tenant_id, 'victim'); // the claim is present but server.mjs uses trust.realm
});

test('bbx-622-05 the tenant realm JWKS is fetched on demand', async () => {
  const v = makeVerifier();
  await v.verify(sign(tenantKey.privateKey, baseClaims({ iss: TENANT_ISSUER }), { kid: 'tenant-key' }));
  assert.ok((fetchCounts[TENANT_CERTS] ?? 0) >= 1, 'verifier must fetch the tenant realm certs URL');
});

test('bbx-622-06 an issuer outside the trusted Keycloak base is rejected', async () => {
  const v = makeVerifier();
  await assert.rejects(
    v.verify(sign(tenantKey.privateKey, baseClaims({ iss: 'http://evil.example/realms/ten-acme' }), { kid: 'tenant-key' })),
    /issuer not trusted/,
  );
});

test('bbx-622-07 a tenant-realm iss signed with the platform key is rejected', async () => {
  const v = makeVerifier();
  // Claims iss=tenant realm but signed with the PLATFORM key (kid mismatch in the tenant JWKS).
  await assert.rejects(
    v.verify(sign(platformKey.privateKey, baseClaims({ iss: TENANT_ISSUER }), { kid: 'platform-key' })),
    /no matching JWKS key/,
  );
});

test('bbx-622-08 alg:none and a tampered signature are rejected', async () => {
  const v = makeVerifier();
  const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(baseClaims({ iss: PLATFORM_ISSUER }))}.`;
  await assert.rejects(v.verify(none), /unsupported alg/);

  const tok = sign(platformKey.privateKey, baseClaims({ iss: PLATFORM_ISSUER, aud: 'in-falcone' }), { kid: 'platform-key' });
  const [h, , s] = tok.split('.');
  const forged = `${h}.${b64url(baseClaims({ iss: PLATFORM_ISSUER, aud: 'in-falcone', tenant_id: 'x' }))}.${s}`;
  await assert.rejects(v.verify(forged), /bad signature/);
});
