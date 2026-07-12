/**
 * Black-box regression: bind-iam-realm-to-caller-tenant
 *
 * Verifies that the Falcone-layer IAM admin adapter enforces the
 * realm == tenantId invariant for tenant-scoped callers and that
 * platform-scoped callers remain exempt.
 *
 * Only the public interface (exported symbols) of the module under test
 * is exercised; no internals are accessed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIamAdminAdapterCall,
  validateIamAdminRequest
} from '../../packages/adapters/src/keycloak-admin.mjs';

// ─── bbx-iam-cross-realm-01 ──────────────────────────────────────────────────
// Non-platform caller where context.realmId != tenantId must fail validation
// and buildIamAdminAdapterCall must throw before returning any adapter call.

test('bbx-iam-cross-realm-01: validateIamAdminRequest rejects cross-tenant realm for tenant-scoped caller', () => {
  const result = validateIamAdminRequest({
    resourceKind: 'user',
    action: 'delete',
    tenantId: 'tenant-a',
    context: { scope: 'tenant', realmId: 'tenant-b' },
    payload: { username: 'victim' }
  });

  assert.equal(result.ok, false, 'validation must not pass for cross-tenant realm');
  assert.ok(
    result.violations.some((v) => v.includes('tenant-b') || v.includes('tenant-a') || v.toLowerCase().includes('realm')),
    `expected a realm-binding violation, got: ${JSON.stringify(result.violations)}`
  );
});

test('bbx-iam-cross-realm-01: buildIamAdminAdapterCall throws (forbidden) for cross-tenant realm', () => {
  let thrownError;
  try {
    buildIamAdminAdapterCall({
      resourceKind: 'user',
      action: 'delete',
      callId: 'call_cross_realm_01',
      tenantId: 'tenant-a',
      context: { scope: 'tenant', realmId: 'tenant-b' },
      payload: { username: 'victim' }
    });
  } catch (err) {
    thrownError = err;
  }

  assert.ok(thrownError, 'buildIamAdminAdapterCall must throw for cross-tenant realm');
  // The error must be identifiable as a 403/forbidden condition
  const is403 =
    thrownError.status === 403 ||
    thrownError.code === 'FORBIDDEN' ||
    (thrownError.validation &&
      thrownError.validation.violations.some((v) => v.includes('tenant-b') || v.includes('tenant-a')));
  assert.ok(is403, `error must carry a 403/forbidden signal, got: ${thrownError.message} status=${thrownError.status}`);
});

// ─── bbx-iam-cross-realm-02 ──────────────────────────────────────────────────
// Non-platform caller where context.realmId === tenantId must succeed.

test('bbx-iam-cross-realm-02: validateIamAdminRequest passes when realmId matches tenantId (tenant scope)', () => {
  const result = validateIamAdminRequest({
    resourceKind: 'user',
    action: 'create',
    tenantId: 'tenant-alpha',
    context: { scope: 'tenant', realmId: 'tenant-alpha' },
    payload: { username: 'alice' }
  });

  assert.equal(result.ok, true, `expected validation to pass, violations: ${JSON.stringify(result.violations)}`);
});

test('bbx-iam-cross-realm-02: buildIamAdminAdapterCall succeeds when realmId matches tenantId', () => {
  let adapterCall;
  assert.doesNotThrow(() => {
    adapterCall = buildIamAdminAdapterCall({
      resourceKind: 'user',
      action: 'create',
      callId: 'call_same_realm_01',
      tenantId: 'tenant-alpha',
      context: { scope: 'tenant', realmId: 'tenant-alpha' },
      payload: { username: 'alice' }
    });
  }, 'buildIamAdminAdapterCall must not throw when realmId matches tenantId');

  assert.ok(adapterCall, 'adapter call object must be returned');
  assert.equal(adapterCall.adapter_id, 'keycloak');
});

// ─── bbx-iam-cross-realm-03 ──────────────────────────────────────────────────
// Platform-scoped callers are exempt from the realmId === tenantId assertion.

test('bbx-iam-cross-realm-03: platform-scoped caller is exempt from realm binding (validateIamAdminRequest)', () => {
  const result = validateIamAdminRequest({
    resourceKind: 'realm',
    action: 'create',
    tenantId: 'platform',
    context: { scope: 'platform', realmId: 'any-tenant-realm' },
    payload: { realmId: 'any-tenant-realm' }
  });

  assert.equal(result.ok, true, `platform caller must be exempt, violations: ${JSON.stringify(result.violations)}`);
});

test('bbx-iam-cross-realm-03: buildIamAdminAdapterCall succeeds for platform scope targeting any realm', () => {
  let adapterCall;
  assert.doesNotThrow(() => {
    adapterCall = buildIamAdminAdapterCall({
      resourceKind: 'realm',
      action: 'create',
      callId: 'call_platform_01',
      tenantId: 'platform',
      context: { scope: 'platform', realmId: 'some-other-tenant-realm' },
      payload: { realmId: 'some-other-tenant-realm' }
    });
  }, 'platform-scoped call must not throw for cross-realm operation');

  assert.ok(adapterCall, 'adapter call must be returned for platform scope');
});

// ─── bbx-iam-cross-realm-04 ──────────────────────────────────────────────────
// tenantId must always be forwarded from buildIamAdminAdapterCall into
// validateIamAdminRequest so that the binding check fires.

test('bbx-iam-cross-realm-04: tenantId propagation — cross-tenant check fires even for workspace scope', () => {
  let thrownError;
  try {
    buildIamAdminAdapterCall({
      resourceKind: 'client',
      action: 'create',
      callId: 'call_ws_cross_realm_01',
      tenantId: 'tenant-x',
      context: {
        scope: 'workspace',
        realmId: 'tenant-y',
        workspaceClientNamespace: 'tenant-x-dev'
      },
      payload: {
        clientId: 'tenant-x-dev-app',
        accessType: 'confidential',
        redirectUris: ['https://example.com/callback']
      }
    });
  } catch (err) {
    thrownError = err;
  }

  assert.ok(thrownError, 'must throw for workspace-scoped cross-tenant realm attempt');
  const hasForbidden =
    thrownError.status === 403 ||
    thrownError.code === 'FORBIDDEN' ||
    (thrownError.validation &&
      thrownError.validation.violations.some((v) => v.includes('tenant-y') || v.includes('tenant-x')));
  assert.ok(hasForbidden, `error must signal forbidden, got: ${thrownError.message}`);
});

// ─── bbx-iam-cross-realm-05 ──────────────────────────────────────────────────
// Fail-closed: a non-platform request that targets a realm but carries no
// tenantId must be rejected (a missing tenantId never equals the targeted realm),
// so no code path can reach Keycloak adapter logic without the binding check.

test('bbx-iam-cross-realm-05: non-platform request with a realmId but no tenantId is rejected (fail-closed)', () => {
  const result = validateIamAdminRequest({
    resourceKind: 'user',
    action: 'delete',
    // tenantId intentionally omitted
    context: { scope: 'tenant', realmId: 'tenant-b' },
    payload: { username: 'victim' }
  });

  assert.equal(result.ok, false, 'missing tenantId must not bypass the realm-binding check');
  assert.ok(
    result.violations.some((v) => v.includes('tenant-b')),
    `expected a realm-binding violation, got: ${JSON.stringify(result.violations)}`
  );
});
