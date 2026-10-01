// Unit tests for the executor's dependency-free Bearer-JWT verifier (node:crypto + JWKS).
// Mints RSA-signed tokens locally and serves the public key via a stub JWKS fetch, then
// asserts both the happy path (claims → identity) and the security rejections that matter
// for JWT verification (tamper, expiry, issuer/audience, alg:none, HS* confusion, kid).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJwtVerifier, tenantAudienceOptionsFromEnv } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' };

function signRs256(payload, { kid = 'test-key-1' } = {}) {
  const head = b64url({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const NOW = 1_900_000_000_000; // fixed clock (ms)
const tNow = Math.floor(NOW / 1000);
const baseClaims = { sub: 'user-1', tenant_id: 'ten-jwt', workspace_id: 'ws-jwt', exp: tNow + 600, realm_access: { roles: ['tenant_admin'] }, scope: 'data:read data:write' };

// JWKS stub; track fetch count to assert caching / rotation behavior.
let fetchCount = 0;
const jwksFetch = async () => { fetchCount += 1; return { ok: true, json: async () => ({ keys: [jwk] }) }; };
const verifier = createJwtVerifier({ jwksUrl: 'https://kc.test/jwks', fetchImpl: jwksFetch, now: () => NOW });

test('createJwtVerifier returns undefined when no jwksUrl is configured', () => {
  assert.equal(createJwtVerifier({}), undefined);
});

test('valid RS256 token → identity derived from claims', async () => {
  const id = await verifier.verify(signRs256(baseClaims));
  assert.equal(id.tenantId, 'ten-jwt');
  assert.equal(id.workspaceId, 'ws-jwt');
  assert.equal(id.actorId, 'user-1');
  assert.deepEqual(id.roles, ['tenant_admin']);
  assert.deepEqual(id.scopes, ['data:read', 'data:write']);
  assert.deepEqual(id.workspaceIds, ['ws-jwt']);
  assert.equal(id.dbRole, undefined); // a JWT is not an api-key → no RLS SET ROLE
});

test('tampered payload → rejected (signature mismatch)', async () => {
  const tok = signRs256(baseClaims);
  const [h, , s] = tok.split('.');
  const forged = `${h}.${b64url({ ...baseClaims, tenant_id: 'victim' })}.${s}`;
  await assert.rejects(verifier.verify(forged), /signature/);
});

test('expired token → rejected', async () => {
  await assert.rejects(verifier.verify(signRs256({ ...baseClaims, exp: tNow - 3600 })), /expired/);
});

test('alg:none → rejected (no unsigned tokens)', async () => {
  const tok = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(baseClaims)}.`;
  await assert.rejects(verifier.verify(tok), /unsupported alg/);
});

test('HS256 forgery with the public key as MAC secret → rejected (no algorithm confusion)', async () => {
  const head = b64url({ alg: 'HS256', kid: 'test-key-1', typ: 'JWT' });
  const body = b64url(baseClaims);
  const pubPem = publicKey.export({ format: 'pem', type: 'spki' });
  const mac = crypto.createHmac('sha256', pubPem).update(`${head}.${body}`).digest('base64url');
  await assert.rejects(verifier.verify(`${head}.${body}.${mac}`), /unsupported alg/);
});

test('issuer / audience are enforced when configured', async () => {
  const v = createJwtVerifier({ jwksUrl: 'https://kc.test/jwks', fetchImpl: jwksFetch, issuer: 'https://kc/realms/x', audience: 'in-falcone', now: () => NOW });
  await assert.rejects(v.verify(signRs256({ ...baseClaims, iss: 'https://evil', aud: 'in-falcone' })), /issuer/);
  await assert.rejects(v.verify(signRs256({ ...baseClaims, iss: 'https://kc/realms/x', aud: 'other' })), /audience/);
  const id = await v.verify(signRs256({ ...baseClaims, iss: 'https://kc/realms/x', aud: ['in-falcone', 'account'] }));
  assert.equal(id.tenantId, 'ten-jwt');
});

test('a signed tenant-realm token derives tenant identity from the realm and keeps its workspace binding', async () => {
  const urls = [];
  const v = createJwtVerifier({
    jwksUrl: 'https://kc.test/realms/platform/protocol/openid-connect/certs',
    issuer: 'https://kc.test/realms/platform',
    audience: 'in-falcone',
    tenantAudience: 'falcone-data-api',
    enforceTenantAudience: true,
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    },
    now: () => NOW,
  });
  const identity = await v.verify(signRs256({
    ...baseClaims,
    iss: 'https://kc.test/realms/tenant-a',
    tenant_id: 'victim-tenant',
    aud: 'falcone-data-api',
    workspace_id: 'ws-a',
  }), 'ws-b');
  assert.equal(identity.tenantId, 'tenant-a');
  assert.equal(identity.workspaceId, 'ws-a');
  assert.equal(identity.credentialWorkspaceId, 'ws-a');
  assert.deepEqual(urls, ['https://kc.test/realms/tenant-a/protocol/openid-connect/certs']);
});

const tenantVerifier = (overrides = {}) => createJwtVerifier({
  jwksUrl: 'https://kc.test/realms/platform/protocol/openid-connect/certs',
  issuer: 'https://kc.test/realms/platform',
  audience: 'in-falcone', tenantAudience: 'falcone-data-api', enforceTenantAudience: true,
  fetchImpl: jwksFetch, now: () => NOW, ...overrides,
});

test('tenant enforcement accepts only exact aud string/array membership, never azp', async () => {
  const v = tenantVerifier();
  const claims = { ...baseClaims, iss: 'https://kc.test/realms/tenant-a' };
  for (const aud of ['falcone-data-api', ['account', 'falcone-data-api']]) {
    assert.equal((await v.verify(signRs256({ ...claims, aud }))).tenantId, 'tenant-a');
  }
  for (const aud of [undefined, null, '', 'other', ['other'], 'falcone-data-api-suffix', ['FALCONE-DATA-API'], 123]) {
    await assert.rejects(v.verify(signRs256({ ...claims, aud, azp: 'falcone-data-api' })), /tenant audience mismatch/);
  }
});

test('tenant enforcement off permits existing tokens without changing platform audience rules', async () => {
  const v = tenantVerifier({ enforceTenantAudience: false, tenantAudience: undefined });
  assert.equal((await v.verify(signRs256({ ...baseClaims, iss: 'https://kc.test/realms/tenant-a', aud: 'other' }))).tenantId, 'tenant-a');
  await assert.rejects(v.verify(signRs256({ ...baseClaims, iss: 'https://kc.test/realms/platform', aud: 'falcone-data-api' })), /audience mismatch/);
  assert.equal((await tenantVerifier().verify(signRs256({ ...baseClaims, iss: 'https://kc.test/realms/platform', aud: 'in-falcone' }))).tenantId, 'ten-jwt');
});

test('enforcement rejects missing/empty audience configuration and invalid flags', () => {
  for (const tenantAudience of [undefined, null, '', '   ']) {
    assert.throws(() => tenantVerifier({ tenantAudience }), /tenant audience is required/);
  }
  assert.throws(() => tenantVerifier({ jwksUrl: undefined }), /JWKS URL is required/);
  assert.throws(() => tenantVerifier({ issuer: undefined, jwksUrl: 'https://kc.test/jwks' }), /realm topology is required/);
  assert.throws(() => tenantVerifier({ enforceTenantAudience: 'true' }), /must be boolean/);
  assert.deepEqual(tenantAudienceOptionsFromEnv({}), { tenantAudience: undefined, enforceTenantAudience: false });
  assert.deepEqual(tenantAudienceOptionsFromEnv({ KEYCLOAK_TENANT_AUDIENCE: 'custom', KEYCLOAK_ENFORCE_TENANT_AUDIENCE: 'true' }),
    { tenantAudience: 'custom', enforceTenantAudience: true });
  assert.equal(tenantAudienceOptionsFromEnv({ KEYCLOAK_ENFORCE_TENANT_AUDIENCE: 'false' }).enforceTenantAudience, false);
  for (const flag of ['', 'yes', 'TRUE']) {
    assert.throws(() => tenantAudienceOptionsFromEnv({ KEYCLOAK_ENFORCE_TENANT_AUDIENCE: flag }), /must be true or false/);
  }
});

test('unknown kid triggers a single JWKS refetch (key rotation), then rejects if still absent', async () => {
  fetchCount = 0;
  await verifier.verify(signRs256(baseClaims)); // primes/uses cache
  const before = fetchCount;
  await assert.rejects(verifier.verify(signRs256(baseClaims, { kid: 'rotated-away' })), /no matching JWKS key/);
  assert.ok(fetchCount > before, 'should refetch JWKS once on unknown kid');
});
