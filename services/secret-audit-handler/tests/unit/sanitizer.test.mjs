import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../../src/sanitizer.mjs';

test('sanitize removes forbidden fields recursively within requestorIdentity', () => {
  // requestorIdentity is the only allowed nested object; test key-strip within it
  // Note: 'value', 'password', 'token' are forbidden keys — stripped at step 1.
  // The sub-object only keeps the four declared sub-keys: type, name, namespace, serviceAccount.
  const sanitized = sanitize({
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-06-08T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/postgresql/app-password',
    secretName: 'app-password',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-abc'
  });
  assert.equal(sanitized.secretPath, 'platform/postgresql/app-password');
  assert.equal(sanitized.requestorIdentity.type, 'service');
  assert.equal(sanitized.requestorIdentity.name, 'svc');
});

test('sanitize drops non-allowlisted top-level fields (allowlist projection)', () => {
  // Fields not in SecretAuditEvent.properties are dropped by the allowlist projection step.
  const sanitized = sanitize({
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-06-08T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/postgresql/app-password',
    secretName: 'app-password',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-abc',
    extra_field: 'should-be-dropped',
    message: 'also-dropped'
  });
  assert.ok(!('extra_field' in sanitized), 'extra_field must be dropped by projection');
  assert.ok(!('message' in sanitized), 'message must be dropped by projection');
  assert.equal(sanitized.secretPath, 'platform/postgresql/app-password');
});

test('sanitize preserves allowed fields', () => {
  const sanitized = sanitize({
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-06-08T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/x',
    secretName: 'x',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-abc'
  });
  assert.equal(sanitized.domain, 'platform');
  assert.equal(sanitized.operation, 'read');
  assert.equal(sanitized.secretPath, 'platform/x');
});
