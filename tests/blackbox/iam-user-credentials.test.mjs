/**
 * Black-box tests for fix-iam-user-credentials (P1, live E2E re-run 2026-06-18
 * BUG-IAM-CREDENTIALS-DROP).
 *
 * Defect: `POST /v1/iam/realms/{realm}/users` read only `body.password`, so a caller
 * using the standard Keycloak `credentials: [{type:'password', value}]` array had the
 * password silently dropped — the user was created with no credential and ROPC login
 * failed with invalid_grant.
 *
 * Fix: the create-user handler accepts the password from the documented
 * `bootstrapCredentials.temporaryPassword` field, and still accepts legacy
 * `password` / `credentials` payloads for compatibility.
 *
 * Drives the public export credentialPasswordFromBody from b-handlers.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { credentialPasswordFromBody } from '../../deploy/kind/control-plane/b-handlers.mjs';

test('bbx-iam-cred-00: documented bootstrapCredentials.temporaryPassword is honored', () => {
  assert.deepEqual(
    credentialPasswordFromBody({ bootstrapCredentials: { temporaryPassword: 'CorrectHorse12' } }),
    { value: 'CorrectHorse12', temporary: false },
  );
});

test('bbx-iam-cred-01: flat password field is honored', () => {
  assert.deepEqual(credentialPasswordFromBody({ password: 'p@ss' }), { value: 'p@ss', temporary: false });
});

test('bbx-iam-cred-02: standard credentials array is honored (the regression)', () => {
  const r = credentialPasswordFromBody({ credentials: [{ type: 'password', value: 's3cret' }] });
  assert.deepEqual(r, { value: 's3cret', temporary: false }, 'credentials[].value must not be dropped');
});

test('bbx-iam-cred-03: temporary flag flows through from the credential', () => {
  assert.equal(credentialPasswordFromBody({ credentials: [{ type: 'password', value: 'x', temporary: true }] }).temporary, true);
  assert.equal(credentialPasswordFromBody({ password: 'x', temporary: true }).temporary, true);
});

test('bbx-iam-cred-04: no password → null (user created without a credential)', () => {
  assert.equal(credentialPasswordFromBody({}), null);
  assert.equal(credentialPasswordFromBody({ credentials: [] }), null);
});

test('bbx-iam-cred-05: non-password credential types are ignored', () => {
  assert.equal(credentialPasswordFromBody({ credentials: [{ type: 'otp', value: '123456' }] }), null);
});
