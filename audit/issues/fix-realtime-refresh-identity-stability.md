Realtime refreshToken allows tenant/actor drift (cross-tenant session hijack)

**Change ID:** fix-realtime-refresh-identity-stability
**Capability:** realtime
**Type:** bug
**Priority:** P0 (Critical)
**OpenSpec change:** openspec/changes/fix-realtime-refresh-identity-stability/

---

## Why

`refreshToken` in `services/realtime-gateway/src/auth/session-manager.mjs` (lines 185-232) validates the new token's signature but then unconditionally overwrites `session.claims` with the incoming token's claims without checking that `claims.tenant_id === session.tenantId` or `claims.sub === session.actorIdentity`. A valid token from tenant B can therefore rebind the in-memory claims of tenant A's session, redirecting all subsequent scope checks and publish guards for that session to tenant B's identity — a cross-tenant session hijack / confused deputy.

## What Changes

- In `refreshToken`, after `validateTokenFn(newBearerToken)` succeeds, assert that `claims.tenant_id === session.tenantId` AND `claims.sub === session.actorIdentity`; if either assertion fails, call `closeSession` and throw a `403 IDENTITY_MISMATCH` error before any state is mutated.
- Session DB columns `tenant_id` / `actor_identity` are the authoritative identity anchor; the new token must match them.
- No API surface change; existing callers that present the correct tenant's own renewed token are unaffected.

---

## Spec delta (EARS)

### Requirement: refreshToken MUST reject tokens whose tenant does not match the session

The system SHALL verify that `claims.tenant_id` in the new Bearer token equals `session.tenantId` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch, without mutating any session state.

#### Scenario: Cross-tenant token rejected on refresh (bbx-refresh-tenant-drift)

- **WHEN** a caller invokes `refreshToken` for session S (created for tenant A, actor X) with a validly-signed token whose `tenant_id` is tenant B (a different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and the session's `tenant_id` and in-memory `claims.tenant_id` remain bound to tenant A (or the session is closed and no subsequent scope checks run under tenant B's identity)

### Requirement: refreshToken MUST reject tokens whose actor does not match the session

The system SHALL verify that `claims.sub` in the new Bearer token equals `session.actorIdentity` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch.

#### Scenario: Actor drift rejected on refresh

- **WHEN** a caller invokes `refreshToken` for session S (created for actor X in tenant A) with a validly-signed token whose `sub` is actor Y (a different actor, same or different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and no scope check or publish-guard for session S evaluates actor Y's claims

### Requirement: refreshToken MUST NOT mutate session identity anchors

The system SHALL ensure that after a successful `refreshToken` call the DB columns `tenant_id` and `actor_identity` for the session row remain equal to their values at session creation time, and `session.tenantId` and `session.actorIdentity` in memory remain unchanged.

#### Scenario: Successful refresh preserves session identity anchors

- **WHEN** a caller invokes `refreshToken` for session S with a validly-signed token that matches `session.tenantId` and `session.actorIdentity`
- **THEN** the session DB row `tenant_id` and `actor_identity` columns are unchanged, `session.tenantId` and `session.actorIdentity` in memory are unchanged, and the session status becomes `ACTIVE`

---

## Tasks

### 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-refresh-tenant-drift` to `tests/blackbox/` that creates a session for tenant A (actor X), then calls `refreshToken` with a validly-signed token for tenant B, and asserts the call returns an `IDENTITY_MISMATCH` error and does not leave the session in a state where subsequent scope checks evaluate tenant B's claims
- [ ] 1.2 Add a companion assertion in `bbx-refresh-tenant-drift` verifying that a `refreshToken` call with a different `sub` (actor drift) is also rejected with `IDENTITY_MISMATCH`
- [ ] 1.3 Confirm both assertions fail (red) against the current unpatched code before proceeding

### 2. Implement the Fix

- [ ] 2.1 In `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken`, after `const claims = await validateTokenFn(newBearerToken)`, add an identity-stability guard: if `claims.tenant_id !== session.tenantId || claims.sub !== session.actorIdentity`, call `closeSession(sessionId, db)` and throw an error with `code: 'IDENTITY_MISMATCH'` before mutating any session state
- [ ] 2.2 Ensure the `IDENTITY_MISMATCH` error message does not include the session's `tenantId` or `actorIdentity` values

### 3. Verify

- [ ] 3.1 Confirm `bbx-refresh-tenant-drift` tests now pass (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

---

## Acceptance criteria

**bbx-refresh-tenant-drift**: calling `refreshToken(sessionId, tokenForTenantB)` where the session was created for tenant A returns an `IDENTITY_MISMATCH` error (or equivalent rejection) and does NOT leave `session.claims.tenant_id` set to tenant B's identity for any subsequent scope check or publish-guard call.

---

## Code evidence

- `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken` — line 193: `const claims = await validateTokenFn(newBearerToken)` — signature verified here
- `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken` — line 194: `session.claims = claims` — unconditional overwrite of in-memory claims with no tenant or actor equality check
- `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken` — lines 202-211: DB `UPDATE realtime_sessions` updates only `token_jti`, `token_expires_at`, `last_validated_at`, `status` — `tenant_id` and `actor_identity` columns are never verified or updated, creating a split between DB anchor and in-memory `session.claims`
- `services/realtime-gateway/src/auth/session-manager.mjs::startPolling` — lines 120-124: `checkScopesFn({ ...session.claims, ... }, session.workspaceId, ...)` — directly spreads `session.claims`; if overwritten with tenant B's claims, all polling scope checks run under tenant B's identity
- `services/realtime-gateway/src/auth/session-manager.mjs::createSession` — lines 158-160: correctly anchors `session.tenantId = claims.tenant_id` and `session.actorIdentity = claims.sub` at creation time (the anchor that `refreshToken` fails to verify against)

---

## Resolution (OpenSpec)

1. `/opsx:apply fix-realtime-refresh-identity-stability` — implement the fix following tasks.md
2. `/opsx:verify fix-realtime-refresh-identity-stability` — run the verify profile
3. `bash tests/blackbox/run.sh` — confirm green
4. `/opsx:archive fix-realtime-refresh-identity-stability` — sync delta into openspec/specs/ and archive the change

Or use the wrapper: `/fix-bug fix-realtime-refresh-identity-stability`

Optional real E2E: `/e2e-issue fix-realtime-refresh-identity-stability`
