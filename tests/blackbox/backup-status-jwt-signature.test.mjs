// bbx-bkp-jwt-forge-01
//
// Black-box reproduction for issue #205 / change verify-backup-status-jwt-signature.
// Drives the PUBLIC validateToken() from backup-status.auth.js only (no network, no DB).
//
// Scenarios covered:
//   S1 (TEST_MODE=true, non-production): base64url payload token parses → returns claims
//   S2 (TEST_MODE=false, KEYCLOAK_JWKS_URL set): a crafted token without valid signature
//       must be REJECTED with a 401-class error (signature not verified → throw).
//       Pre-fix: the function returns decoded claims without verifying the signature.
//       Post-fix: jwtVerify fails on a forged token → throws AuthError(401, ...).
//   S3 (TEST_MODE=true + NODE_ENV=production): must throw/refuse — TEST_MODE in production
//       is a mis-configuration; forged tokens must never be accepted in prod.
//
// Rationale for blackbox placement: backup-status.auth.js is a compiled JS module with
// no transitive imports that require pg or JWKS network. The test drives only the public
// validateToken() export and checks the observable behavior (return claims vs throw).
// The service vitest suite covers the deeper cryptographic correctness (valid-signed
// token round-trip using a local keypair) because that requires jose/jwks-rsa installed.

import test from 'node:test';
import assert from 'node:assert/strict';

// Helper: build a JWT-like token with the given payload (no real signature).
// Uses base64url encoding of a minimal header + the payload, plus a fake sig.
function makeForgedToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.INVALIDSIGNATURE`;
}

// ---------------------------------------------------------------------------
// S1: TEST_MODE (non-production) — forged base64url token parses cleanly
// ---------------------------------------------------------------------------
test('bbx-bkp-jwt-forge-01: TEST_MODE parses forged payload and returns claims', async () => {
  delete process.env.NODE_ENV; // ensure not production
  process.env.TEST_MODE = 'true';
  delete process.env.KEYCLOAK_JWKS_URL;

  // Re-import fresh module so env picks up
  const { validateToken } = await import(
    '../../services/backup-status/src/api/backup-status.auth.js?s1'
  );

  const payload = {
    sub: 'user-a',
    tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    scopes: ['backup:restore:global'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = makeForgedToken(payload);
  const claims = await validateToken(token);
  assert.equal(claims.tenantId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.deepEqual(claims.scopes, ['backup:restore:global']);
});

// ---------------------------------------------------------------------------
// S2: non-TEST_MODE, JWKS URL set, forged token → must throw (signature check)
//
// Pre-fix: validateToken returns decoded claims from an unsigned token (BUG).
// Post-fix: jwtVerify fails because the signature is invalid → AuthError(401, ...) thrown.
// ---------------------------------------------------------------------------
test('bbx-bkp-jwt-forge-01: non-TEST_MODE forged token must be rejected (401)', async () => {
  delete process.env.NODE_ENV;
  delete process.env.TEST_MODE;
  process.env.KEYCLOAK_JWKS_URL = 'https://keycloak.internal/realms/falcone/protocol/openid-connect/certs';
  process.env.KEYCLOAK_ISSUER = 'https://keycloak.internal/realms/falcone';
  process.env.KEYCLOAK_AUDIENCE = 'backup-status';

  const { validateToken, AuthError } = await import(
    '../../services/backup-status/src/api/backup-status.auth.js?s2'
  );

  const payload = {
    sub: 'attacker',
    tenant_id: 'victim-tenant-id',
    scopes: ['backup:restore:global', 'superadmin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://keycloak.internal/realms/falcone',
    aud: 'backup-status',
  };
  const forgedToken = makeForgedToken(payload);

  // Post-fix: must throw because the signature is not valid.
  // Pre-fix (bug): returns decoded claims without signature check — test will FAIL.
  await assert.rejects(
    () => validateToken(forgedToken),
    (err) => {
      // Accept any thrown error; ideally an AuthError with statusCode 401
      return err instanceof Error;
    },
    'A forged token (invalid signature) must be rejected when not in TEST_MODE'
  );
});

// ---------------------------------------------------------------------------
// S3: TEST_MODE=true with NODE_ENV=production → must refuse (mis-config guard)
//
// Pre-fix: TEST_MODE is accepted even in production → forged tokens pass.
// Post-fix: validateToken throws immediately if NODE_ENV=production && TEST_MODE=true.
// ---------------------------------------------------------------------------
test('bbx-bkp-jwt-forge-01: TEST_MODE must be refused in NODE_ENV=production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.TEST_MODE = 'true';
  delete process.env.KEYCLOAK_JWKS_URL;

  const { validateToken } = await import(
    '../../services/backup-status/src/api/backup-status.auth.js?s3'
  );

  const token = makeForgedToken({ sub: 'attacker', tenant_id: 'victim', scopes: [] });

  await assert.rejects(
    () => validateToken(token),
    (err) => err instanceof Error,
    'TEST_MODE in NODE_ENV=production must cause validateToken to throw'
  );

  // Cleanup
  delete process.env.NODE_ENV;
  delete process.env.TEST_MODE;
});
