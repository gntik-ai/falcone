/**
 * Black-box tests for secret-audit value-level redaction and allowlist projection.
 * (fix-secret-audit-value-redaction / GitHub issue #266)
 *
 * Drives the public exported API of:
 *   - sanitizer.mjs     :: sanitize
 *   - event-schema.mjs  :: hasForbiddenField, validateAuditEvent
 *
 * bbx-secret-sanitize-value-01: denialReason with embedded PEM private key is redacted
 * bbx-secret-sanitize-value-02: denialReason with long base64 blob is redacted
 * bbx-secret-sanitize-value-03: denialReason with inline token= assignment is redacted
 * bbx-secret-sanitize-value-04: denialReason with long hex blob is redacted
 * bbx-secret-sanitize-value-05: non-allowlisted extra field is dropped by projection
 * bbx-secret-sanitize-value-06: false-positive guard — normal event is preserved verbatim
 * bbx-secret-sanitize-value-07: sanitized event passes validateAuditEvent (no throw)
 * bbx-secret-sanitize-value-08: hasForbiddenField returns true for event with raw secret in value
 * bbx-secret-sanitize-value-09: hasForbiddenField returns false after sanitize (redacted sentinel)
 * bbx-secret-sanitize-value-10: requestorIdentity.name with embedded secret is redacted
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitize } from '../../packages/secret-audit-handler/src/sanitizer.mjs';
import { hasForbiddenField, validateAuditEvent } from '../../packages/secret-audit-handler/src/event-schema.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid audit event shape (as produced by parseVaultEntry). */
function makeEvent(overrides = {}) {
  return {
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-06-08T00:00:00.000Z',
    operation: 'read',
    domain: 'tenant',
    secretPath: 'tenant/acme/db-password',
    secretName: 'db-password',
    requestorIdentity: {
      type: 'service',
      name: 'svc-acme',
      namespace: 'tenant-acme',
      serviceAccount: 'svc-acme-sa'
    },
    tenantId: 'acme',
    result: 'denied',
    denialReason: 'permission denied',
    vaultRequestId: 'req-abc-001',
    ...overrides
  };
}

const PEM_PRIVATE_KEY =
  '-----BEGIN RSA PRIVATE KEY-----\n' +
  'MIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29P2rFj7jvlhLz\n' +
  'morebase64hereXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n' +
  '-----END RSA PRIVATE KEY-----';

// Long base64 blob (>= 40 contiguous base64 chars, no slashes)
const LONG_BASE64 = 'dGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgZW5jb2RlZCBzZWNyZXQgdmFsdWU=';

// Inline token assignment
const INLINE_TOKEN = 'Vault denied access: token=AKIAIOSFODNN7EXAMPLEKEY';

// Long hex blob (>= 32 contiguous hex chars)
const LONG_HEX = 'deadbeef' + 'cafebabe' + '12345678' + '9abcdef0'; // 32 hex chars

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-01: PEM private key in denialReason is redacted
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-01: denialReason with embedded PEM private key is redacted', () => {
  const raw = makeEvent({ denialReason: `access denied: ${PEM_PRIVATE_KEY}` });
  const result = sanitize(raw);

  assert.ok(
    !result.denialReason.includes('BEGIN RSA PRIVATE KEY'),
    `Expected PEM header absent, got: ${result.denialReason}`
  );
  assert.ok(
    result.denialReason.includes('[REDACTED]'),
    `Expected [REDACTED] sentinel present, got: ${result.denialReason}`
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-02: long base64 blob in denialReason is redacted
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-02: denialReason with long base64 blob is redacted', () => {
  const raw = makeEvent({ denialReason: `error: blob=${LONG_BASE64}` });
  const result = sanitize(raw);

  assert.ok(
    !result.denialReason.includes(LONG_BASE64),
    `Expected base64 blob absent, got: ${result.denialReason}`
  );
  assert.ok(
    result.denialReason.includes('[REDACTED]'),
    `Expected [REDACTED] sentinel, got: ${result.denialReason}`
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-03: inline token= assignment in denialReason is redacted
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-03: denialReason with inline token= assignment is redacted', () => {
  const raw = makeEvent({ denialReason: INLINE_TOKEN });
  const result = sanitize(raw);

  assert.ok(
    !result.denialReason.includes('AKIAIOSFODNN7EXAMPLEKEY'),
    `Expected token value absent, got: ${result.denialReason}`
  );
  assert.ok(
    result.denialReason.includes('[REDACTED]'),
    `Expected [REDACTED] sentinel, got: ${result.denialReason}`
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-04: long hex blob in denialReason is redacted
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-04: denialReason with long hex blob is redacted', () => {
  const raw = makeEvent({ denialReason: `secret hash: ${LONG_HEX}` });
  const result = sanitize(raw);

  assert.ok(
    !result.denialReason.includes(LONG_HEX),
    `Expected hex blob absent, got: ${result.denialReason}`
  );
  assert.ok(
    result.denialReason.includes('[REDACTED]'),
    `Expected [REDACTED] sentinel, got: ${result.denialReason}`
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-05: non-allowlisted extra field is dropped by projection
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-05: non-allowlisted extra field is dropped by projection', () => {
  // Value is irrelevant: this test asserts the non-allowlisted `message` field is
  // dropped entirely by projection. A non-secret-shaped placeholder is used so the
  // fixture does not trip secret-scanning push protection.
  const raw = makeEvent({ message: 'non-allowlisted-field-placeholder' });
  const result = sanitize(raw);

  assert.ok(
    !('message' in result),
    `Expected 'message' field absent after projection, keys: ${Object.keys(result).join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-06: false-positive guard — normal event preserved verbatim
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-06: false-positive guard — normal event preserved verbatim', () => {
  const raw = makeEvent({
    denialReason: 'permission denied',
    secretPath: 'tenant/acme/db-password',
    secretName: 'db-password'
  });
  const result = sanitize(raw);

  // Core safe fields must survive unchanged
  assert.equal(result.eventId, raw.eventId, 'eventId must be preserved');
  assert.equal(result.timestamp, raw.timestamp, 'timestamp must be preserved');
  assert.equal(result.operation, raw.operation, 'operation must be preserved');
  assert.equal(result.domain, raw.domain, 'domain must be preserved');
  assert.equal(result.secretPath, 'tenant/acme/db-password', 'secretPath must be preserved');
  assert.equal(result.secretName, 'db-password', 'secretName must be preserved');
  assert.equal(result.result, raw.result, 'result must be preserved');
  assert.equal(result.denialReason, 'permission denied', 'denialReason must be preserved');
  assert.equal(result.vaultRequestId, raw.vaultRequestId, 'vaultRequestId must be preserved');
  assert.equal(result.tenantId, 'acme', 'tenantId must be preserved');

  // Must not inject false [REDACTED]
  const json = JSON.stringify(result);
  assert.ok(!json.includes('[REDACTED]'), `Expected no [REDACTED] sentinel in normal event, got: ${json}`);
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-07: sanitized event with secret in denialReason passes validateAuditEvent
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-07: sanitized event with secret passes validateAuditEvent (no throw)', () => {
  const raw = makeEvent({ denialReason: `error: ${PEM_PRIVATE_KEY}` });
  const result = sanitize(raw);

  // validateAuditEvent must not throw — [REDACTED] is safe
  assert.doesNotThrow(
    () => validateAuditEvent(result),
    'validateAuditEvent must accept sanitized event'
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-08: hasForbiddenField returns true for raw secret in value
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-08: hasForbiddenField returns true for event with raw secret in value', () => {
  const raw = makeEvent({ denialReason: `error: ${PEM_PRIVATE_KEY}` });
  // hasForbiddenField must detect secret material in string value
  assert.equal(
    hasForbiddenField(raw),
    true,
    'hasForbiddenField must return true when a string value contains secret material'
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-09: hasForbiddenField returns false after sanitize
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-09: hasForbiddenField returns false after sanitize (redacted sentinel safe)', () => {
  const raw = makeEvent({ denialReason: `error: ${PEM_PRIVATE_KEY}` });
  const result = sanitize(raw);
  assert.equal(
    hasForbiddenField(result),
    false,
    'hasForbiddenField must return false for correctly-redacted event'
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-sanitize-value-10: requestorIdentity.name with embedded secret is redacted
// ---------------------------------------------------------------------------
test('bbx-secret-sanitize-value-10: requestorIdentity.name with embedded secret is redacted', () => {
  const raw = makeEvent({
    requestorIdentity: {
      type: 'service',
      name: `svc:token=AKIAIOSFODNN7EXAMPLEKEY`,
      namespace: 'tenant-acme',
      serviceAccount: 'svc-sa'
    }
  });
  const result = sanitize(raw);

  assert.ok(
    !result.requestorIdentity.name.includes('AKIAIOSFODNN7EXAMPLEKEY'),
    `Expected token value absent from requestorIdentity.name, got: ${result.requestorIdentity.name}`
  );
  assert.ok(
    result.requestorIdentity.name.includes('[REDACTED]'),
    `Expected [REDACTED] in requestorIdentity.name, got: ${result.requestorIdentity.name}`
  );
});
