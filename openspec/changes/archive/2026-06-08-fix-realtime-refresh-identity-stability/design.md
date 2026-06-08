## Context

`createSession` correctly anchors `session.tenantId = claims.tenant_id` and `session.actorIdentity = claims.sub` (lines 158-160) and persists them as DB columns `tenant_id` / `actor_identity`. `refreshToken` (lines 185-232) subsequently calls `validateTokenFn(newBearerToken)` which performs full JWKS signature verification, but then immediately overwrites `session.claims = claims` (line 194) without comparing the new claims against the session's identity anchor. The `startPolling` loop (line 91-143) then calls `checkScopesFn({ ...session.claims, ... }, session.workspaceId, session.channelType, db)` — if `session.claims.tenant_id` was replaced with tenant B's value, all subsequent scope revalidation runs under tenant B's identity.

## Goals / Non-Goals

**Goals:**
- Enforce that `refreshToken` only accepts a token whose `tenant_id` and `sub` match the session's anchored identity.
- Close the session on mismatch to prevent any further use of the corrupted state.
- Maintain correct behaviour for the normal case (same tenant, same actor).

**Non-Goals:**
- Changing the `createSession` flow (it is already correct).
- Modifying `validateTokenFn` or JWKS configuration.
- Addressing the separate issuer/audience binding gap (bug-006; tracked separately).

## Decisions

**Decision: Close the session on identity mismatch, do not just reject the refresh.**
Rationale: A token from a different tenant being presented for an existing session suggests either a programming error by the client or an active attack. Allowing the session to remain open with stale claims creates a window for retries or race conditions. Closing is the conservative safe action.

**Decision: Compare `claims.tenant_id` and `claims.sub` (not the full claims object).**
Rationale: These are the two identity anchors stored in the DB and used to scope all data access. Other claims (scopes, authorizedWorkspaces) are legitimately expected to change on refresh.

**Alternative considered:** Only reject without closing the session. Rejected: leaves an open session whose token has expired and whose in-memory claims have not been updated, causing a stuck-suspended state.

## Risks / Trade-offs

**Risk:** Clients that accidentally call `refreshToken` with a token from the wrong tenant receive a session close rather than just an error they can recover from.
**Mitigation:** This is intentional and correct. A client that presents a cross-tenant token for refresh is misconfigured; session closure forces re-authentication from a clean state.

**Risk:** The identity-mismatch error path must not leak information about which tenant owns the session.
**Mitigation:** Return a generic `IDENTITY_MISMATCH` error without the session's tenant identity in the message.

## Migration Plan

No schema or API changes. The guard is added before any state mutation. Existing well-behaved clients (same tenant, same actor) are unaffected. Malformed clients will receive a new `IDENTITY_MISMATCH` error code on `refreshToken`.
