/**
 * Black-box tests for fix-tenant-config-verify-role-claims.
 *
 * Drives the public `main` exports of the tenant-config action family via
 * their injected deps (overrides.auth DI hook) — no internal knowledge
 * beyond the public function signature.
 *
 * Security invariants under test:
 *   1. No trusted gateway headers (even WITH a forged Bearer JWT) → 401 UNAUTHORIZED
 *   2. Forged unsigned JWT carrying superadmin role + admin scope, but NO
 *      x-actor-roles / x-actor-scopes headers → must NOT be treated as
 *      superadmin → 401 (JWT payload is ignored)
 *   3. Trusted headers present (x-tenant-id + x-actor-roles: superadmin +
 *      x-actor-scopes with required scope) → proceeds (200/2xx)
 *   4. Trusted headers present but role/scope insufficient → 403
 *
 * Actions covered:
 *   bbx-tcfg-migrate-*     : tenant-config-migrate
 *   bbx-tcfg-validate-*    : tenant-config-validate
 *   bbx-tcfg-export-*      : tenant-config-export
 *   bbx-tcfg-domains-*     : tenant-config-export-domains
 *   bbx-tcfg-formats-*     : tenant-config-format-versions
 *   bbx-tcfg-preflight-*   : tenant-config-preflight
 *   bbx-tcfg-reprovision-* : tenant-config-reprovision
 *   bbx-tcfg-idmap-*       : tenant-config-identifier-map
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { main as migrate } from '../../services/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs';
import { main as validate } from '../../services/provisioning-orchestrator/src/actions/tenant-config-validate.mjs';
import { main as exportAction } from '../../services/provisioning-orchestrator/src/actions/tenant-config-export.mjs';
import { main as exportDomains } from '../../services/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs';
import { main as formatVersions } from '../../services/provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs';
import { main as preflight } from '../../services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs';
import { main as reprovision } from '../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { main as identifierMap } from '../../services/provisioning-orchestrator/src/actions/tenant-config-identifier-map.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'ten_test-aaaaaaaaa';

/** Build a base64url-encoded unsigned JWT (header.payload — no signature). */
function forgeJwt(payload) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'none', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.`;
}

/** Minimal no-op Kafka producer (fire-and-forget, never throws). */
function fakeKafka() {
  return { async send() {} };
}

/** Minimal no-op audit / event functions. */
const noopAudit = async () => {};
const noopPublish = async () => {};

/** Minimal DI overrides shared across actions that need DB/Kafka/audit. */
function sharedOverrides(extra = {}) {
  return {
    kafkaProducer: fakeKafka(),
    insertExportAuditLog: noopAudit,
    publishExportCompleted: noopPublish,
    publishMigrationEvent: noopPublish,
    publishValidationEvent: noopPublish,
    publishPreflightAuditEvent: noopPublish,
    publishReprovisionCompleted: noopPublish,
    publishIdentifierMapGenerated: noopPublish,
    insertPreflightAuditLog: noopAudit,
    insertReprovisionAuditLog: noopAudit,
    tenantExists: async () => true,
    ...extra,
  };
}

/**
 * Minimal valid artifact for migration / validation tests.
 * format_version '1.0.0' keeps schema checks simple.
 */
const VALID_ARTIFACT = {
  format_version: '1.0.0',
  tenant_id: TENANT_ID,
  domains: [],
};

// ---------------------------------------------------------------------------
// SCENARIO 1: No trusted gateway headers + forged JWT → 401
// ---------------------------------------------------------------------------
//
// The attacker passes a self-crafted unsigned JWT claiming superadmin, but
// provides NO x-actor-roles / x-actor-scopes / x-tenant-id gateway headers.
// The action MUST return 401 (identity absent) and MUST NOT grant access.

const FORGED_SUPERADMIN_JWT = forgeJwt({
  realm_access: { roles: ['superadmin'] },
  scope: 'platform:admin:config:export platform:admin:config:reprovision',
  sub: 'attacker',
  azp: 'attacker-client',
});

// bbx-tcfg-migrate-no-headers
test('bbx-tcfg-migrate-no-headers: migrate with forged JWT but no gateway headers returns 401', async () => {
  const result = await migrate(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides(),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-validate-no-headers
test('bbx-tcfg-validate-no-headers: validate with forged JWT but no gateway headers returns 401', async () => {
  const result = await validate(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides(),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-export-no-headers
test('bbx-tcfg-export-no-headers: export with forged JWT but no gateway headers returns 401', async () => {
  const result = await exportAction(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      tenant_id: TENANT_ID,
    },
    sharedOverrides({ getRegistry: () => new Map() }),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-domains-no-headers
test('bbx-tcfg-domains-no-headers: export-domains with forged JWT but no gateway headers returns 401', async () => {
  const result = await exportDomains(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      tenant_id: TENANT_ID,
    },
    sharedOverrides({ getRegistry: () => new Map() }),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-formats-no-headers
test('bbx-tcfg-formats-no-headers: format-versions with forged JWT but no gateway headers returns 401', async () => {
  const result = await formatVersions(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
    },
    sharedOverrides(),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-preflight-no-headers
test('bbx-tcfg-preflight-no-headers: preflight with forged JWT but no gateway headers returns 401', async () => {
  const result = await preflight(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      tenant_id: TENANT_ID,
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides(),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-reprovision-no-headers
test('bbx-tcfg-reprovision-no-headers: reprovision with forged JWT but no gateway headers returns 401', async () => {
  const result = await reprovision(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      tenant_id: TENANT_ID,
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides({ getApplierRegistry: () => new Map() }),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-idmap-no-headers
test('bbx-tcfg-idmap-no-headers: identifier-map with forged JWT but no gateway headers returns 401', async () => {
  const artifact = { ...VALID_ARTIFACT, tenant_id: 'ten_source-bbb' };
  const result = await identifierMap(
    {
      __ow_headers: { authorization: `Bearer ${FORGED_SUPERADMIN_JWT}` },
      tenant_id: TENANT_ID,
      artifact,
    },
    sharedOverrides(),
  );
  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// ---------------------------------------------------------------------------
// SCENARIO 2: Trusted headers present but insufficient role/scope → 403
// ---------------------------------------------------------------------------
//
// The gateway injects x-tenant-id + x-actor-roles: tenant_owner (no privilege)
// and x-actor-scopes missing the admin scope. The action MUST return 403.

// bbx-tcfg-migrate-insufficient-role
test('bbx-tcfg-migrate-insufficient-role: migrate with trusted headers but wrong role returns 403', async () => {
  const result = await migrate(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_ID,
        'x-auth-subject': 'user:tenant-owner',
        'x-actor-roles': 'tenant_owner',
        'x-actor-scopes': 'openid profile',
      },
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides(),
  );
  assert.equal(result.statusCode, 403, `expected 403, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// bbx-tcfg-reprovision-insufficient-role
test('bbx-tcfg-reprovision-insufficient-role: reprovision with trusted headers but wrong role returns 403', async () => {
  const result = await reprovision(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_ID,
        'x-auth-subject': 'user:tenant-owner',
        'x-actor-roles': 'tenant_owner',
        'x-actor-scopes': 'openid profile',
      },
      tenant_id: TENANT_ID,
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides({ getApplierRegistry: () => new Map() }),
  );
  assert.equal(result.statusCode, 403, `expected 403, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
});

// ---------------------------------------------------------------------------
// SCENARIO 3: Valid trusted headers → action proceeds (200 / 2xx path)
// ---------------------------------------------------------------------------
//
// The gateway injects x-tenant-id, x-actor-roles: superadmin, x-actor-scopes
// including the required admin scope. The action MUST proceed past auth
// (it will reach schema/validation logic, not 401/403).

// bbx-tcfg-migrate-trusted-headers-superadmin
test('bbx-tcfg-migrate-trusted-headers-superadmin: migrate with trusted superadmin headers proceeds past auth (no 401/403)', async () => {
  const result = await migrate(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_ID,
        'x-auth-subject': 'svc:platform-admin',
        'x-actor-roles': 'superadmin',
        'x-actor-scopes': 'platform:admin:config:export',
      },
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides(),
  );
  assert.notEqual(result.statusCode, 401, `must not return 401, got ${result.statusCode}`);
  assert.notEqual(result.statusCode, 403, `must not return 403, got ${result.statusCode}`);
});

// bbx-tcfg-formats-trusted-headers-sre
test('bbx-tcfg-formats-trusted-headers-sre: format-versions with trusted sre headers proceeds past auth (no 401/403)', async () => {
  const result = await formatVersions(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_ID,
        'x-auth-subject': 'user:sre-engineer',
        'x-actor-roles': 'sre',
        'x-actor-scopes': 'platform:admin:config:export',
      },
    },
    sharedOverrides(),
  );
  assert.notEqual(result.statusCode, 401, `must not return 401, got ${result.statusCode}`);
  assert.notEqual(result.statusCode, 403, `must not return 403, got ${result.statusCode}`);
});

// bbx-tcfg-reprovision-trusted-headers-superadmin
test('bbx-tcfg-reprovision-trusted-headers-superadmin: reprovision with trusted superadmin headers proceeds past auth', async () => {
  const result = await reprovision(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_ID,
        'x-auth-subject': 'svc:platform-admin',
        'x-actor-roles': 'superadmin',
        'x-actor-scopes': 'platform:admin:config:reprovision',
      },
      tenant_id: TENANT_ID,
      artifact: VALID_ARTIFACT,
    },
    sharedOverrides({ getApplierRegistry: () => new Map() }),
  );
  assert.notEqual(result.statusCode, 401, `must not return 401, got ${result.statusCode}`);
  assert.notEqual(result.statusCode, 403, `must not return 403, got ${result.statusCode}`);
});
