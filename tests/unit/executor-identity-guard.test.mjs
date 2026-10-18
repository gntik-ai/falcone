import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertIdentityVerification } from '../../apps/control-plane-executor/src/runtime/identity-guard.mjs';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const mainUrl = new URL('../../apps/control-plane-executor/src/runtime/main.mjs', import.meta.url);

test('missing verifier and no development opt-in refuses identity fallback', () => {
  assert.throws(() => assertIdentityVerification({ jwtVerifier: undefined, env: {} }), {
    code: 'EXECUTOR_JWT_VERIFIER_REQUIRED',
  });
});

test('a configured verifier takes precedence over development opt-in', () => {
  assert.deepEqual(assertIdentityVerification({ jwtVerifier: {}, env: {} }), { mode: 'verified' });
  assert.deepEqual(assertIdentityVerification({ jwtVerifier: {}, env: { EXECUTOR_ALLOW_UNVERIFIED_IDENTITY: 'true' } }), { mode: 'verified' });
});

test('exact development opt-in allows unverified identity and emits a startup warning', () => {
  assert.deepEqual(assertIdentityVerification({ jwtVerifier: undefined, env: { EXECUTOR_ALLOW_UNVERIFIED_IDENTITY: 'true' } }), { mode: 'unverified-dev' });
  const main = readFileSync(mainUrl, 'utf8');
  assert.match(main, /if \(identityVerification\.mode === 'unverified-dev'\)\s*\{\s*console\.warn\('\[control-plane\] bearer tokens are not verified: EXECUTOR_ALLOW_UNVERIFIED_IDENTITY'\);\s*\}/);
});

for (const value of ['1', 'yes', 'TRUE', ' true ', '']) {
  test(`development opt-in rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => assertIdentityVerification({ jwtVerifier: undefined, env: { EXECUTOR_ALLOW_UNVERIFIED_IDENTITY: value } }), {
      code: 'EXECUTOR_JWT_VERIFIER_REQUIRED',
    });
  });
}

test('an empty JWKS configuration returns no verifier and is refused', () => {
  const jwtVerifier = createJwtVerifier({ jwksUrl: '' });
  assert.equal(jwtVerifier, undefined);
  assert.throws(() => assertIdentityVerification({ jwtVerifier, env: {} }), {
    code: 'EXECUTOR_JWT_VERIFIER_REQUIRED',
  });
});

test('tenant audience enforcement still rejects an empty JWKS URL during construction', () => {
  assert.throws(() => createJwtVerifier({ jwksUrl: '', enforceTenantAudience: true }), /tenant audience is required/);
  assert.throws(() => createJwtVerifier({ jwksUrl: '', enforceTenantAudience: true, tenantAudience: 'tenant-api' }), /JWKS URL is required/);
});

test('refusal names configuration variables without disclosing their values', () => {
  const sampleUrl = 'https://identity.example.test/realms/sample/protocol/openid-connect/certs';
  assert.throws(() => assertIdentityVerification({ jwtVerifier: undefined, env: { KEYCLOAK_JWKS_URL: sampleUrl, EXECUTOR_ALLOW_UNVERIFIED_IDENTITY: 'private-sample-value' } }), (error) => {
    assert.equal(error.code, 'EXECUTOR_JWT_VERIFIER_REQUIRED');
    assert.match(error.message, /KEYCLOAK_JWKS_URL/);
    assert.match(error.message, /EXECUTOR_ALLOW_UNVERIFIED_IDENTITY/);
    assert.ok(!error.message.includes(sampleUrl));
    assert.ok(!error.message.includes('private-sample-value'));
    return true;
  });
});

test('executor checks JWT verification before boot and reports construction or guard refusal', () => {
  const main = readFileSync(mainUrl, 'utf8');
  const construction = main.indexOf('createJwtVerifier(');
  const guard = main.indexOf('assertIdentityVerification(');
  const boot = main.indexOf('void boot()');
  assert.ok(construction >= 0 && guard > construction && boot > guard);
  assert.ok(guard < main.indexOf('server.listen('));
  // Both failures must reach the same code-only refusal, before schema DDL or listen.
  assert.match(main, /try\s*\{\s*jwtVerifier = createJwtVerifier\([\s\S]*?assertIdentityVerification\(\{\s*jwtVerifier,\s*env: process\.env\s*\}\)[\s\S]*?\}\s*catch\s*\{\s*console\.error\('\[control-plane\] startup refused: EXECUTOR_JWT_VERIFIER_REQUIRED'\);\s*process\.exit\(1\);\s*\}/);
});
