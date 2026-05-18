## Why

Several token-validation and scope-check paths in the realtime-gateway library
are silently insecure. From `openspec/audit/cap-b2-realtime-auth-scope-validation.md`:

- **B4** (`services/realtime-gateway/src/auth/session-manager.mjs:185-214`) —
  `refreshToken` calls `validateTokenFn` (signature/exp only), assigns
  `session.claims = claims`, writes DB `status='ACTIVE'`, restarts polling.
  No `checkScopesFn` call. A token whose scopes were revoked between the
  prior poll and this refresh will resume to ACTIVE; the violation is only
  detected on the next poll, up to `SCOPE_REVALIDATION_INTERVAL_SECONDS` later.
- **B5** (`services/realtime-gateway/src/actions/validate-subscription-auth.mjs:8-20`)
  — the active-subscription quota query filters
  `AND actor_identity = $3`, so `MAX_SUBSCRIPTIONS_PER_WORKSPACE` is enforced
  per-actor not per-workspace. A 50-cap workspace with 1000 users can hold
  50 000 active sessions.
- **B6** (`session-manager.mjs:11`) — the default `introspectTokenFn` is
  `async () => ({ active: true, scopes: [] })`. With any workspace mapping,
  the first poll calls `checkScopesFn(..., scopes: [])`, returns
  `allowed: false`, and auto-suspends every session within ~30s. Every
  default deployment is broken.
- **B13** (`services/realtime-gateway/src/auth/scope-checker.mjs:30-44`) —
  scope mappings cache per `(tenantId, workspaceId)` with TTL equal to the
  revalidation interval (default 30s). `scope-mapping-repository.mjs:26-52`
  writes new mappings without notifying the cache. Up to 30s of stale
  allow-decisions after revocation.
- **B15** (`scope-checker.mjs:67-75`) — when no mappings exist for a
  `(tenantId, workspaceId)`, the checker falls back to allowing if the token
  bears `realtime:read`. Operators who clear all mappings inadvertently grant
  channel access to anyone with the generic scope. Fail-open default.

## What Changes

- Make `refreshToken` at `session-manager.mjs:185-214` re-call `checkScopesFn`
  with the new claims before flipping `status='ACTIVE'`; on failure emit
  `DENIED` and call `suspendSession`.
- Rewrite the active-subscription quota query at
  `validate-subscription-auth.mjs:8-20` to drop the `actor_identity` filter so
  the cap is enforced per `(tenant, workspace)`. Add a separate, lower per-actor
  cap if desired.
- Remove the default no-op `introspectTokenFn` at `session-manager.mjs:11`;
  make the parameter required and assert at construction time. Document the
  contract so consumers MUST inject the real introspector.
- Add a publish/subscribe cache-invalidation hook in
  `scope-mapping-repository.mjs:26-52` that bumps a per-`(tenant, workspace)`
  version counter consulted on every `scope-checker` read.
- Replace the allow-open fallback at `scope-checker.mjs:67-75` with a
  fail-closed default: when no mappings exist, the checker MUST deny with
  `missingScope: '<channel-type>'` rather than allow `realtime:read`.

## Capabilities

### Modified Capabilities

- `identity-and-access`: re-validation of scopes on token refresh, correct
  quota semantics, mandatory token introspector, cache invalidation, and
  fail-closed scope-checker default.

## Impact

- Affected code:
  `services/realtime-gateway/src/auth/session-manager.mjs`,
  `services/realtime-gateway/src/auth/scope-checker.mjs`,
  `services/realtime-gateway/src/auth/scope-mapping-repository.mjs`,
  `services/realtime-gateway/src/actions/validate-subscription-auth.mjs`,
  `services/realtime-gateway/src/config/env.mjs`.
- Migrations: optional new index on
  `realtime_sessions(tenant_id, workspace_id, status)` to support the
  per-workspace quota query.
- Breaking changes:
  - Consumers that constructed the session manager without
    `introspectTokenFn` will get a construction-time error.
  - Workspaces that relied on the no-mappings-allow-open fallback will see
    channel access denied; operators MUST configure mappings explicitly.
  - Per-workspace quota lowers the headroom of workspaces with many actors.
- Out of scope: schema integrity (covered by `harden-b2-schema-integrity`);
  audit-emission asymmetry (covered by `fix-b2-audit-emission-asymmetry`).
