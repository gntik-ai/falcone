## Why

`refreshToken` in `services/realtime-gateway/src/auth/session-manager.mjs` (lines 185-232) validates the new token's signature but then unconditionally overwrites `session.claims` with the incoming token's claims without checking that `claims.tenant_id === session.tenantId` or `claims.sub === session.actorIdentity`. A valid token from tenant B can therefore rebind the in-memory claims of tenant A's session, redirecting all subsequent scope checks and publish guards for that session to tenant B's identity — a cross-tenant session hijack / confused deputy.

## What Changes

- In `refreshToken`, after `validateTokenFn(newBearerToken)` succeeds, assert that `claims.tenant_id === session.tenantId` AND `claims.sub === session.actorIdentity`; if either assertion fails, call `closeSession` and throw a `403 IDENTITY_MISMATCH` error before any state is mutated.
- Session DB columns `tenant_id` / `actor_identity` are the authoritative identity anchor; the new token must match them.
- No API surface change; existing callers that present the correct tenant's own renewed token are unaffected.

## Capabilities

### New Capabilities

- `realtime`: `refreshToken` enforces tenant and actor identity stability; a token from a different tenant or actor cannot be used to refresh an existing session.

### Modified Capabilities

## Impact

- `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken` (lines 185-232)
- `services/realtime-gateway/src/auth/session-manager.mjs::createSession` (lines 145-183) — sets the identity anchor correctly; this change protects it during refresh
- `services/realtime-gateway/src/auth/scope-checker.mjs` — downstream consumer of `session.claims` used in `startPolling`; no change needed but must be tested
