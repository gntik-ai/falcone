/**
 * Black-box regression: fix-signup-enforce-password-policy (#669)
 *
 * The self-service signup policy endpoint (GET /v1/auth/signups/policy) ADVERTISES
 * `passwordPolicy.minLength`, but POST /v1/auth/signups did NOT ENFORCE it: a
 * 1-character password was accepted, the Keycloak user was created, and the
 * account authenticated. This binds the ADVERTISED value to the ENFORCED boundary
 * so the two cannot drift, and proves no Keycloak user is created on rejection.
 *
 * Only the public interface is exercised (AUTH_HANDLERS.signup / .signupPolicy).
 * kcAdmin and the tenant store are injected via ctx._kcAdmin and a fake pool
 * (the handler uses ctx._kcAdmin ?? module-level kcAdmin and ctx.pool).
 *
 * Acceptance (issue #669):
 *  - Requirement: signup SHALL reject a password shorter than the advertised
 *    minimum length → 400 VALIDATION_ERROR, with NO Keycloak user created.
 *  - Scenario A (sub-minimum rejected): sub-minimum password → 400, no account.
 *  - Scenario B (compliant accepted): policy-compliant password → 201.
 *  - Invariant: the value signupPolicy ADVERTISES == the value signup ENFORCES.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTH_HANDLERS } from '../../deploy/kind/control-plane/auth-handlers.mjs';

const { signup, signupPolicy } = AUTH_HANDLERS;

// ─── constants ────────────────────────────────────────────────────────────────
const TENANT_ID    = 'ffd33d99-aaaa-bbbb-cccc-000000000669';
const WORKSPACE_ID = 'ws-0001-aaaa-bbbb-cccc-000000000669';
const TENANT_REALM = TENANT_ID; // Falcone realm-per-tenant: realm name == tenantId

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Fake pool returning a known tenant record (mirrors tenant-store.getTenant). */
function fakeTenantPool(tenant) {
  return {
    async query(_sql, _params) {
      return { rows: tenant ? [tenant] : [] };
    },
  };
}

/** Fake kcAdmin that records createUser calls and returns a deterministic id. */
function fakeKcAdmin(capturedCalls = []) {
  return {
    async createUser(realm, opts) {
      capturedCalls.push({ op: 'createUser', realm, opts });
      return 'user-uuid-' + realm.slice(0, 8);
    },
  };
}

/** Minimal signup ctx mirroring the server's LOCAL_HANDLERS dispatch. */
function makeCtx({ tenantId, workspaceId, email, username, password } = {}, pool, kcAdminMock) {
  return {
    params: {},
    query: {},
    body: { tenantId, workspaceId, email, username, password, primaryEmail: email },
    identity: null,
    callerContext: null,
    pool,
    _kcAdmin: kcAdminMock, // DI seam for test injection
  };
}

const ACTIVE_TENANT = {
  id: TENANT_ID, tenant_id: TENANT_ID, slug: 'acme',
  display_name: 'Acme', status: 'active', iam_realm: TENANT_REALM,
};

// ─── bbx-signup-pw-01: 1-char password rejected, no user created ──────────────

test('bbx-signup-pw-01: 1-char password is rejected (400 VALIDATION_ERROR), no Keycloak user created', async () => {
  const calls = [];
  const result = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'weak@acme.test', username: 'weak', password: 'x' },
    fakeTenantPool(ACTIVE_TENANT), fakeKcAdmin(calls)
  ));

  assert.equal(result.statusCode, 400, `expected 400, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.code, 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${result.body.code}`);

  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(!createCall, `kcAdmin.createUser MUST NOT be called for a sub-minimum password; was called with realm=${createCall?.realm}`);
});

// ─── bbx-signup-pw-02: 7-char (one below default 8) rejected ──────────────────

test('bbx-signup-pw-02: 7-char password (one below default minimum) is rejected, no user created', async () => {
  const calls = [];
  const result = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'short@acme.test', username: 'short', password: 'Abc123!' /* 7 chars */ },
    fakeTenantPool(ACTIVE_TENANT), fakeKcAdmin(calls)
  ));

  assert.equal(result.statusCode, 400, `expected 400, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.code, 'VALIDATION_ERROR');
  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(!createCall, 'kcAdmin.createUser MUST NOT be called for a 7-char password');
});

// ─── bbx-signup-pw-03: compliant 8-char password accepted (201) ───────────────

test('bbx-signup-pw-03: compliant 8-char password is accepted (201), createUser called once with that password', async () => {
  const calls = [];
  const result = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'good@acme.test', username: 'good', password: 'Abcd123!' /* 8 chars */ },
    fakeTenantPool(ACTIVE_TENANT), fakeKcAdmin(calls)
  ));

  assert.equal(result.statusCode, 201, `expected 201, got ${result.statusCode}: ${JSON.stringify(result.body)}`);

  const createCalls = calls.filter((c) => c.op === 'createUser');
  assert.equal(createCalls.length, 1, `createUser must be called exactly once; got ${createCalls.length}`);
  assert.equal(createCalls[0].opts.password, 'Abcd123!', 'createUser must receive the supplied password');
});

// ─── bbx-signup-pw-04: empty password rejected (preserves presence behavior) ──

test('bbx-signup-pw-04: empty password is rejected (400), preserving the existing presence check', async () => {
  const calls = [];
  const result = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'empty@acme.test', username: 'empty', password: '' },
    fakeTenantPool(ACTIVE_TENANT), fakeKcAdmin(calls)
  ));

  assert.equal(result.statusCode, 400, `expected 400, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.code, 'VALIDATION_ERROR');
  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(!createCall, 'kcAdmin.createUser MUST NOT be called for an empty password');
});

// ─── bbx-signup-pw-05: advertised == enforced (no drift) ──────────────────────
// Reads the minimum the policy endpoint ADVERTISES, then proves signup ENFORCES
// exactly that boundary: (min-1) → 400, (min) → 201. This binds the two values.

test('bbx-signup-pw-05: the advertised minLength equals the enforced boundary (no drift)', async () => {
  const policy = await signupPolicy();
  assert.equal(policy.statusCode, 200);
  const min = policy.body.passwordPolicy.minLength;
  assert.ok(Number.isInteger(min) && min > 0, `advertised minLength must be a positive integer; got ${min}`);

  // Just below the advertised minimum → must be rejected, no user created.
  const belowCalls = [];
  const below = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'b@acme.test', username: 'below', password: 'a'.repeat(min - 1) },
    fakeTenantPool(ACTIVE_TENANT), fakeKcAdmin(belowCalls)
  ));
  assert.equal(below.statusCode, 400, `password of length ${min - 1} (advertised min ${min}) must be rejected; got ${below.statusCode}: ${JSON.stringify(below.body)}`);
  assert.equal(below.body.code, 'VALIDATION_ERROR');
  assert.ok(!belowCalls.find((c) => c.op === 'createUser'), 'no user may be created just below the advertised minimum');

  // Exactly at the advertised minimum → must be accepted.
  const atCalls = [];
  const at = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'a@acme.test', username: 'atmin', password: 'a'.repeat(min) },
    fakeTenantPool(ACTIVE_TENANT), fakeKcAdmin(atCalls)
  ));
  assert.equal(at.statusCode, 201, `password of length ${min} (== advertised min) must be accepted; got ${at.statusCode}: ${JSON.stringify(at.body)}`);
  assert.equal(atCalls.filter((c) => c.op === 'createUser').length, 1, 'a policy-compliant password must create exactly one user');
});
