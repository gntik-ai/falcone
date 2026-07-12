/**
 * Black-box regression suite for spec change fix-tenant-realm-token-issuance (finding A3),
 * executor multi-realm JWKS verification half.
 *
 * Drives the executor's public JWT verifier (apps/control-plane-executor/src/runtime/jwt-verify.mjs).
 * Mints RSA-signed tokens for two realms — the platform realm and a per-tenant realm whose NAME
 * equals the tenant id — each served by its own JWKS, and asserts the multi-realm trust model.
 *
 * Defect: the executor verified JWTs only against the platform realm, so tenant-realm tokens were
 * rejected ("issuer mismatch"/"Missing tenant identity") and tenant users could not reach the
 * data-plane.
 *
 * Fix: trust tokens from any realm UNDER THE SAME Keycloak base; for a tenant realm the tenant id
 * is taken from the VERIFIED issuer (the realm name), which cannot be forged by a claim.
 *
 * Scenario coverage (capability: tenant-rbac / spec.md):
 *   bbx-a3-01  platform-realm token → accepted, tenant_id from claim
 *   bbx-a3-02  tenant-realm token → accepted, tenant_id derived from the realm name (== tenant id)
 *   bbx-a3-03  a tenant-A token CANNOT forge tenant_id=B (issuer realm is authoritative)
 *   bbx-a3-04  a token from an issuer outside the trusted Keycloak base is rejected
 *   bbx-a3-05  a tenant-realm token must be signed by ITS realm's key (cross-realm key → rejected)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const NOW = 1_900_000_000_000;
const tNow = Math.floor(NOW / 1000);

const BASE = 'https://kc.test/realms/';
const PLATFORM_REALM = 'in-falcone-platform';
const PLATFORM_ISSUER = `${BASE}${PLATFORM_REALM}`;
const PLATFORM_CERTS = `${PLATFORM_ISSUER}/protocol/openid-connect/certs`;
const TENANT_A = 'tenant-acme-7f3a';
const TENANT_B = 'tenant-globex-9c21';
const TENANT_A_ISSUER = `${BASE}${TENANT_A}`;
const TENANT_A_CERTS = `${TENANT_A_ISSUER}/protocol/openid-connect/certs`;

function keypair(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }, kid };
}
const platform = keypair('platform-key');
const tenantA = keypair('tenant-a-key');

function sign(priv, kid, payload) {
  const head = b64url({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), priv).toString('base64url');
  return `${head}.${body}.${sig}`;
}

// JWKS served per realm certs URL — a token must be signed by the key of the realm it claims.
const JWKS_BY_URL = {
  [PLATFORM_CERTS]: [platform.jwk],
  [TENANT_A_CERTS]: [tenantA.jwk],
};
let fetched = [];
const fetchImpl = async (url) => {
  fetched.push(url);
  const keys = JWKS_BY_URL[url];
  return { ok: !!keys, status: keys ? 200 : 404, json: async () => ({ keys: keys ?? [] }) };
};

const verifier = createJwtVerifier({
  jwksUrl: PLATFORM_CERTS,
  issuer: PLATFORM_ISSUER,
  audience: 'in-falcone-console',
  fetchImpl,
  now: () => NOW,
});

const baseClaims = (extra) => ({ sub: 'user-1', exp: tNow + 600, realm_access: { roles: ['tenant_admin'] }, scope: 'data:read', ...extra });

// -------------------------------------------------------------------------
test('bbx-a3-01: platform-realm token is accepted, tenant_id from claim', async () => {
  const id = await verifier.verify(sign(platform.privateKey, platform.kid,
    baseClaims({ iss: PLATFORM_ISSUER, aud: 'in-falcone-console', tenant_id: 'ten-platform' })));
  assert.equal(id.tenantId, 'ten-platform');
  assert.equal(id.actorId, 'user-1');
});

// -------------------------------------------------------------------------
test('bbx-a3-02: tenant-realm token is accepted, tenant_id derived from the realm name', async () => {
  // No tenant_id claim at all — the verified issuer (realm name) supplies it.
  const id = await verifier.verify(sign(tenantA.privateKey, tenantA.kid,
    baseClaims({ iss: TENANT_A_ISSUER })));
  assert.equal(id.tenantId, TENANT_A, 'tenant id must come from the issuing realm');
  assert.deepEqual(id.roles, ['tenant_admin']);
});

// -------------------------------------------------------------------------
test('bbx-a3-03: a tenant-A token cannot forge tenant_id=B (issuer realm is authoritative)', async () => {
  const id = await verifier.verify(sign(tenantA.privateKey, tenantA.kid,
    baseClaims({ iss: TENANT_A_ISSUER, tenant_id: TENANT_B }))); // claim lies
  assert.equal(id.tenantId, TENANT_A, 'a forged tenant_id claim must be overridden by the realm');
  assert.notEqual(id.tenantId, TENANT_B);
});

// -------------------------------------------------------------------------
test('bbx-a3-04: a token from an issuer outside the trusted Keycloak base is rejected', async () => {
  const evil = keypair('evil-key');
  await assert.rejects(
    verifier.verify(sign(evil.privateKey, evil.kid, baseClaims({ iss: 'https://evil.test/realms/tenant-acme-7f3a' }))),
    /issuer not trusted/,
  );
});

// -------------------------------------------------------------------------
test('bbx-a3-05: a tenant-realm token must be signed by its own realm key', async () => {
  // Signed by the PLATFORM key but claiming the tenant realm → tenant JWKS has no such kid.
  await assert.rejects(
    verifier.verify(sign(platform.privateKey, platform.kid, baseClaims({ iss: TENANT_A_ISSUER }))),
    /no matching JWKS key|bad signature/,
  );
});
