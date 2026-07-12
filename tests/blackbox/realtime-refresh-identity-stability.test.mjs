// Black-box test suite for change fix-realtime-refresh-identity-stability.
// Drives ONLY the public export `createSessionManager` from session-manager.mjs.
// No internal knowledge, no direct file inspection.
//
// Scenarios:
//   bbx-refresh-tenant-drift        — cross-tenant token on refresh → IDENTITY_MISMATCH (FAILS pre-fix)
//   bbx-refresh-actor-drift         — same-tenant but different sub → IDENTITY_MISMATCH (FAILS pre-fix)
//   bbx-refresh-identity-stable     — matching tenant+sub → succeeds, anchors unchanged (passes always)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../../packages/realtime-gateway/src/auth/session-manager.mjs';

// ---------------------------------------------------------------------------
// Shared claim factories
// ---------------------------------------------------------------------------
const EXP = Math.floor(Date.now() / 1000) + 3600;

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACTOR_X  = 'actor-x';
const ACTOR_Y  = 'actor-y';

function claimsForA(sub = ACTOR_X) {
  return { sub, tenant_id: TENANT_A, jti: `jti-a-${sub}`, exp: EXP, scopes: ['realtime:subscribe'] };
}

function claimsForB(sub = ACTOR_X) {
  return { sub, tenant_id: TENANT_B, jti: `jti-b-${sub}`, exp: EXP, scopes: ['realtime:subscribe'] };
}

// ---------------------------------------------------------------------------
// Minimal stub DB (all queries succeed, returning empty rows).
// ---------------------------------------------------------------------------
function makeDb() {
  return { query: async () => ({ rows: [] }) };
}

// Minimal env stub — satisfies startPolling's envProvider() call without
// touching process.env or making real network calls.
function makeEnvProvider() {
  return () => ({
    SCOPE_REVALIDATION_INTERVAL_SECONDS: 30,
    TOKEN_EXPIRY_GRACE_SECONDS: 30
  });
}

// ---------------------------------------------------------------------------
// Build a session manager with injected fakes — no real timers, no real
// JWKS/Kafka.  `validateTokenFn` dispatches on the token string.
// ---------------------------------------------------------------------------
function makeManager(validateTokenFn) {
  return createSessionManager({
    envProvider: makeEnvProvider(),
    validateTokenFn,
    checkScopesFn: async () => ({ allowed: true }),
    setIntervalFn: () => 0,        // prevent real timer leak
    clearIntervalFn: () => {},
    nowFn: () => Date.now(),
    publishAuthDecisionFn: async () => {},
    logger: { error: () => {}, warn: () => {} }
  });
}

// ---------------------------------------------------------------------------
// Scenario bbx-refresh-tenant-drift
// Create session under tenant A / actor X; attempt refresh with tenant B token.
// Expect: IDENTITY_MISMATCH error, session removed/invalidated, claims NOT rebound.
// PRE-FIX: this test fails because refreshToken blindly overwrites session.claims.
// ---------------------------------------------------------------------------
test('bbx-refresh-tenant-drift: refreshToken with cross-tenant token → IDENTITY_MISMATCH, session closed', async () => {
  const db = makeDb();

  // First call (createSession): return tenant-A claims.
  // Second call (refreshToken): return tenant-B claims.
  let callCount = 0;
  const mgr = makeManager(async (_token) => {
    callCount += 1;
    return callCount === 1 ? claimsForA() : claimsForB();
  });

  const { id } = await mgr.createSession('token-a', 'ws-1', 'table', db, {});

  // Verify session was created and is in _activeSessions.
  assert.ok(mgr._activeSessions.has(id), 'session must be present before refresh');

  await assert.rejects(
    () => mgr.refreshToken(id, 'token-b-tenant', db, {}),
    (err) => {
      assert.equal(err.code, 'IDENTITY_MISMATCH',
        `expected err.code === 'IDENTITY_MISMATCH', got ${JSON.stringify(err.code)}`);
      return true;
    },
    'refreshToken must reject with IDENTITY_MISMATCH when tenant_id differs'
  );

  // After rejection the session must be closed / removed from _activeSessions OR
  // its claims.tenant_id must NOT have been rebound to tenant B.
  if (mgr._activeSessions.has(id)) {
    const session = mgr._activeSessions.get(id);
    assert.notEqual(session.claims.tenant_id, TENANT_B,
      'session.claims.tenant_id must NOT be rebound to tenant B after IDENTITY_MISMATCH');
  }
  // If session was deleted from _activeSessions, that is equally acceptable.
});

// ---------------------------------------------------------------------------
// Scenario bbx-refresh-actor-drift
// Same tenant A, but new token has a different sub (actor Y).
// Expect: IDENTITY_MISMATCH error.
// PRE-FIX: this test also fails.
// ---------------------------------------------------------------------------
test('bbx-refresh-actor-drift: refreshToken with same-tenant but different sub → IDENTITY_MISMATCH', async () => {
  const db = makeDb();

  let callCount = 0;
  const mgr = makeManager(async (_token) => {
    callCount += 1;
    // First call: actor X / tenant A.
    // Second call: actor Y / tenant A (drift in sub only).
    return callCount === 1
      ? claimsForA(ACTOR_X)
      : { sub: ACTOR_Y, tenant_id: TENANT_A, jti: `jti-drift`, exp: EXP, scopes: ['realtime:subscribe'] };
  });

  const { id } = await mgr.createSession('token-actor-x', 'ws-1', 'table', db, {});

  await assert.rejects(
    () => mgr.refreshToken(id, 'token-actor-y', db, {}),
    (err) => {
      assert.equal(err.code, 'IDENTITY_MISMATCH',
        `expected err.code === 'IDENTITY_MISMATCH', got ${JSON.stringify(err.code)}`);
      return true;
    },
    'refreshToken must reject with IDENTITY_MISMATCH when sub differs'
  );

  if (mgr._activeSessions.has(id)) {
    const session = mgr._activeSessions.get(id);
    assert.notEqual(session.actorIdentity, ACTOR_Y,
      'session.actorIdentity must NOT be rebound to actor Y after IDENTITY_MISMATCH');
  }
});

// ---------------------------------------------------------------------------
// Scenario bbx-refresh-identity-stable (positive control)
// Same tenant A, same actor X → refresh succeeds, anchors unchanged, status ACTIVE.
// This MUST pass both before AND after the fix.
// ---------------------------------------------------------------------------
test('bbx-refresh-identity-stable: valid refresh with matching identity → succeeds, anchors unchanged', async () => {
  const db = makeDb();

  // Both calls return tenant A / actor X (second call simulates a renewed token).
  const mgr = makeManager(async (_token) => claimsForA());

  const created = await mgr.createSession('token-initial', 'ws-1', 'table', db, {});

  assert.equal(created.tenantId, TENANT_A);
  assert.equal(created.actorIdentity, ACTOR_X);

  // Should NOT reject.
  await assert.doesNotReject(
    () => mgr.refreshToken(created.id, 'token-renewed', db, {}),
    'refreshToken must not reject when tenant_id and sub match'
  );

  // Verify anchors are unchanged.
  const session = mgr._activeSessions.get(created.id);
  assert.ok(session, 'session must still be in _activeSessions after successful refresh');
  assert.equal(session.tenantId, TENANT_A, 'tenantId anchor must be unchanged');
  assert.equal(session.actorIdentity, ACTOR_X, 'actorIdentity anchor must be unchanged');
  assert.equal(session.status, 'ACTIVE', 'session status must be ACTIVE after successful refresh');
});
