# Capability B2 — Realtime Auth & Scope Validation (library)

**Source locus:** `services/realtime-gateway/` (1273 LOC of `.mjs` + 3 SQL migrations + `package.json`). No HTTP or WebSocket server in this package — confirmed by `grep -l 'WebSocket\|ws.Server\|fastify\|express\|http.createServer' services/realtime-gateway` returning nothing. Consumers are expected to embed the action handlers and the session manager into their own transport.

**Method:** Read every file under `src/`, all three migrations, `package.json`, then traced what wraps this library (`charts/realtime-gateway/`, `tests/{unit,integration,e2e}/realtime{,-gateway}/`). Did not trust `docs/` or `01-capability-map.md`.

---

## SPEC (what exists)

### Configuration and feature flag

- **WHEN** the library loads its environment, **THE SYSTEM SHALL** require six environment variables to be non-empty strings: `KEYCLOAK_JWKS_URL`, `KEYCLOAK_INTROSPECTION_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_ID`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`, `DATABASE_URL`, `KAFKA_BROKERS` (`config/env.mjs:1-8, 63-66`).
- **WHEN** any of the above is missing, **THE SYSTEM SHALL** throw `Missing required environment variable: ${key}` (`env.mjs:25`).
- **WHEN** `KAFKA_BROKERS` is provided, **THE SYSTEM SHALL** comma-split and trim, requiring at least one broker (`env.mjs:52-61`).
- **WHEN** numeric env vars are omitted, **THE SYSTEM SHALL** fall back to defaults: `JWKS_CACHE_TTL_SECONDS=300`, `SCOPE_REVALIDATION_INTERVAL_SECONDS=30`, `TOKEN_EXPIRY_GRACE_SECONDS=30`, `MAX_FILTER_PREDICATES=10`, `MAX_SUBSCRIPTIONS_PER_WORKSPACE=50` (`env.mjs:10-21, 81-85`).
- **WHEN** `REALTIME_AUTH_ENABLED` is `'false'` (case-insensitive), **THE SYSTEM SHALL** parse it as `false`, otherwise default to `true` (`env.mjs:68-72, 90`).
- **WHEN** `REALTIME_AUTH_ENABLED` is `false`, **THE SYSTEM SHALL** bypass all authorization and return `{ allowed: true, subscriptionContext: {} }` (`validate-subscription-auth.mjs:34-37`).

### Token validation (action: validate subscription)

- **WHEN** a token is presented as `"Bearer <jwt>"`, **THE SYSTEM SHALL** strip the prefix; otherwise it **SHALL** treat the input as a bare token (`token-validator.mjs:14-24`).
- **WHEN** the JWT header lacks a `kid`, **THE SYSTEM SHALL** raise `AuthError('TOKEN_INVALID', 'JWT header is missing kid.')` (`token-validator.mjs:154-158`).
- **WHEN** the local signing key for `kid` is cached and not expired, **THE SYSTEM SHALL** verify the JWT against the cached key (`token-validator.mjs:106-113, 160-162`).
- **WHEN** verification fails because the `kid` is unknown (matched by `ERR_JWKS_NO_MATCHING_KEY`, `SigningKeyNotFoundError`, or the regex `/signing key/i` / `/no matching key/i`), **THE SYSTEM SHALL** force a JWKS refresh and retry once; if the refreshed retry still cannot find the key, **THE SYSTEM SHALL** call Keycloak token introspection as a fallback (`token-validator.mjs:76-81, 165-187`).
- **WHEN** introspection responds non-2xx, **THE SYSTEM SHALL** raise `AuthError('TOKEN_INVALID', 'Token introspection failed with status ${status}.')` (`token-validator.mjs:140-142`).
- **WHEN** introspection returns `active: false`, **THE SYSTEM SHALL** raise `AuthError('TOKEN_REVOKED', 'Token is inactive or revoked.')` (`token-validator.mjs:146-148`).
- **WHEN** the underlying `jose` library throws `ERR_JWT_EXPIRED` / `JWTExpired`, **THE SYSTEM SHALL** return `AuthError('TOKEN_EXPIRED', 'Token has expired.')` (`token-validator.mjs:88-90`).
- **WHEN** JWTs are verified, **THE SYSTEM SHALL** apply a 5-second clock tolerance (`token-validator.mjs:161`).
- **WHEN** claims are returned, **THE SYSTEM SHALL** normalize `scopes` from either the `scopes` array claim or the space-delimited `scope` string, and `authorizedWorkspaces` from any of `workspace_ids`, `workspaces[]`, `workspace_access` (object keys), or single `workspace_id` (`token-validator.mjs:26-62`).

### Scope check

- **WHEN** `checkScopes` is invoked without a `claims.tenant_id`, **THE SYSTEM SHALL** return `{ allowed: false, missingScope: 'tenant_id' }` (`scope-checker.mjs:47-55`).
- **WHEN** the workspaceId is not in `authorizedWorkspaces`, not a key in `workspace_access`, and not equal to `claims.workspace_id`, **THE SYSTEM SHALL** return `{ allowed: false, missingScope: 'workspace-access' }` (`scope-checker.mjs:4-22, 57-63`).
- **WHEN** no scope→channel mappings exist for `(tenantId, workspaceId)`, **THE SYSTEM SHALL** fall back to allowing only if the token carries `realtime:read` (`scope-checker.mjs:68-75`).
- **WHEN** at least one mapping exists for the channel type (or for `'*'`) and the token includes its `scope_name`, **THE SYSTEM SHALL** allow the subscription and return the matched scope (`scope-checker.mjs:77-88`).
- **WHEN** no matching scope is found, **THE SYSTEM SHALL** deny with `missingScope` set to the first relevant mapping's scope, or `'realtime:read'` if none (`scope-checker.mjs:90-94`).
- **WHEN** scope mappings are loaded, **THE SYSTEM SHALL** cache them in-memory for `SCOPE_REVALIDATION_INTERVAL_SECONDS` per `(tenantId, workspaceId)` (`scope-checker.mjs:30-44`).

### Filter parsing and complexity

- **WHEN** the supplied filter is null/undefined, **THE SYSTEM SHALL** treat it as `passAll: true` (`filter-parser.mjs:43-46`).
- **WHEN** the filter is not an object or is an array, **THE SYSTEM SHALL** raise `FilterValidationError(['Filter must be an object.'])` (`filter-parser.mjs:48-50`).
- **WHEN** the filter object fails AJV validation against `{operation∈{INSERT,UPDATE,DELETE}, entity, predicates:[{field,op,value}]}` with `additionalProperties: false`, **THE SYSTEM SHALL** raise `FilterValidationError` carrying the AJV error list (`filter-parser.mjs:13-39, 56-65`).
- **WHEN** the parsed filter has more than `MAX_FILTER_PREDICATES` predicates, **THE SYSTEM SHALL** raise `FilterValidationError([\`Filter exceeds maximum predicate count of ${maxPredicates}.\`])` (`complexity-checker.mjs:3-11`).
- **WHEN** the filter is valid, **THE SYSTEM SHALL** return `{ passAll: false, operation, entity, predicates[] }` (`filter-parser.mjs:67-77`).

### Filter evaluation (against streamed events)

- **WHEN** evaluating an event, **THE SYSTEM SHALL** read each predicate field from `event.data`, then `event.payload`, then `event.after`, then top-level (`filter-evaluator.mjs:1-15`).
- **WHEN** the filter specifies `operation`/`entity`, **THE SYSTEM SHALL** drop events whose `operation`/`entity` doesn't match (`filter-evaluator.mjs:45-51`).
- **WHEN** every predicate matches (operators: `eq`, `neq`, `contains` on strings/arrays), **THE SYSTEM SHALL** return `true` (`filter-evaluator.mjs:17-37, 53`).
- **WHEN** an unknown operator is used in a predicate, **THE SYSTEM SHALL** return `false` for that predicate (`filter-evaluator.mjs:35-36`).

### Subscription auth action

- **WHEN** the validate-subscription-auth action runs, **THE SYSTEM SHALL** in order: validate token → check scopes → parse and complexity-check filter → count active subscriptions → emit either GRANTED or one of `{TOKEN_INVALID, TOKEN_EXPIRED, TOKEN_REVOKED, INSUFFICIENT_SCOPE, INVALID_FILTER, QUOTA_EXCEEDED}` denial events, then return `{ allowed, error?, subscriptionContext? }` (`validate-subscription-auth.mjs:31-158`).
- **WHEN** counting active subscriptions, **THE SYSTEM SHALL** filter `realtime_sessions` by `(tenant_id, workspace_id, actor_identity)` with `status = 'ACTIVE'` (`validate-subscription-auth.mjs:8-20`).
- **WHEN** the active count reaches `MAX_SUBSCRIPTIONS_PER_WORKSPACE`, **THE SYSTEM SHALL** deny with `QUOTA_EXCEEDED` (`validate-subscription-auth.mjs:116-135`).
- **WHEN** GRANTED is returned, **THE SYSTEM SHALL** include `subscriptionContext = { tenantId, workspaceId, actorIdentity, channelType, filterSpec }` (`validate-subscription-auth.mjs:148-157`).

### Session manager (long-running, in-memory)

- **WHEN** `createSession` is called, **THE SYSTEM SHALL** validate the token, check scopes, and on success INSERT a row into `realtime_sessions` with status `'ACTIVE'` (`session-manager.mjs:145-172`).
- **WHEN** a session is created, **THE SYSTEM SHALL** start a `setInterval` poller that every `SCOPE_REVALIDATION_INTERVAL_SECONDS` checks (a) token expiry plus `TOKEN_EXPIRY_GRACE_SECONDS`, (b) introspection's `active`, (c) `checkScopes` against the current claims (`session-manager.mjs:91-142, 173`).
- **WHEN** the polling cycle detects expiry, **THE SYSTEM SHALL** suspend with `suspensionReason: 'TOKEN_EXPIRED'`; when introspection returns `active: false`, **THE SYSTEM SHALL** suspend with `'TOKEN_EXPIRED'` if past expiry else `'SCOPE_REVOKED'`; when scope check fails, **THE SYSTEM SHALL** suspend with `'SCOPE_REVOKED'` (`session-manager.mjs:103-129`).
- **WHEN** `suspendSession` runs and the session is already SUSPENDED or CLOSED, **THE SYSTEM SHALL** early-return without re-emitting (`session-manager.mjs:62-66`).
- **WHEN** `refreshToken` succeeds and the prior session status was SUSPENDED, **THE SYSTEM SHALL** publish a RESUMED audit event (`session-manager.mjs:216-231`).
- **WHEN** `closeSession` runs, **THE SYSTEM SHALL** clear the timer, set DB status to `'CLOSED'`, and delete from the in-memory map (`session-manager.mjs:234-244`).
- **WHEN** `shutdown` runs, **THE SYSTEM SHALL** clear every timer, mark every session `'CLOSED'` in memory, and empty the map (`session-manager.mjs:246-253`) — note: it does **not** UPDATE the DB.

### Scope-revocation action

- **WHEN** `handle-scope-revocation` runs for `(actorIdentity, tenantId)`, **THE SYSTEM SHALL** UPDATE every `realtime_sessions` row matching `(actor_identity, tenant_id, status='ACTIVE')` to `'SUSPENDED'` and emit one `SUSPENDED` audit event per session with `suspensionReason: 'SCOPE_REVOKED'` (`handle-scope-revocation.mjs:7-44`).
- **WHEN** the action completes, **THE SYSTEM SHALL** return `{ suspendedCount }` (`handle-scope-revocation.mjs:46`).

### Audit publisher

- **WHEN** an authorization decision is published, **THE SYSTEM SHALL** build a payload `{ eventType, tenantId, workspaceId, actorIdentity, subscriptionId?, channelType, scopesEvaluated, filterSnapshot?, denialReason?, missingScope?, suspensionReason?, resumedAt?, timestamp }` (`audit-publisher.mjs:114-130`).
- **WHEN** action is `GRANTED`/`DENIED`/`SUSPENDED`/`RESUMED`, **THE SYSTEM SHALL** validate the payload against a per-action AJV schema before sending (`audit-publisher.mjs:46-82, 140-151`).
- **WHEN** the payload is valid, **THE SYSTEM SHALL** Kafka-send to one of four topics: `console.realtime.auth-granted/.auth-denied/.session-suspended/.session-resumed` (defaults configurable) (`audit-publisher.mjs:84-97, 153-156`).
- **WHEN** the Kafka send succeeds, **THE SYSTEM SHALL** INSERT a Postgres row into `realtime_subscription_auth_records` (`audit-publisher.mjs:158-171`).
- **WHEN** the Postgres insert throws, **THE SYSTEM SHALL** log via `logger.error` and swallow the error (`audit-publisher.mjs:172-174`).

### Tenant/workspace isolation guard

- **WHEN** `guardEvent(event, sessionContext)` is called, **THE SYSTEM SHALL** return true only if both `tenantId` and `workspaceId` strictly match between the event and the session context (`isolation/tenant-workspace-guard.mjs:1-4`).

### Persistence schema

- **WHEN** the schema is initialised, **THE SYSTEM SHALL** create three tables:
  - `realtime_scope_channel_mappings(id UUID PK, tenant_id, workspace_id, scope_name, channel_type, created_at, updated_at, created_by, UNIQUE(tenant_id, workspace_id, scope_name, channel_type))` (`migrations/001-create-realtime-scope-channel-mappings.sql`).
  - `realtime_subscription_auth_records(id UUID PK, tenant_id, workspace_id, actor_identity, subscription_id, channel_type, action, denial_reason, scopes_evaluated JSONB, filter_snapshot JSONB, created_at)` (`migrations/002-create-realtime-subscription-auth-records.sql`).
  - `realtime_sessions(id UUID PK, tenant_id, workspace_id, actor_identity, token_jti, token_expires_at, status default 'ACTIVE', last_validated_at, created_at, updated_at)` (`migrations/003-create-realtime-sessions.sql`).

---

## GAPS

1. **No HTTP/WS server in-package.** `grep` for WebSocket/Fastify/Express/http.createServer in `services/realtime-gateway/` returns zero hits. The library only exposes action functions and a session-manager factory. The transport that actually serves clients lives in `charts/realtime-gateway/templates/{configmap-apisix-plugin.yaml,deployment.yaml}` (APISIX plugin pattern). The mapping from "incoming WS frame" to `validateTokenFn` / `createSession` / `closeSession` / `refreshToken` is outside this package; the audit-map's "WebSocket transport must live in another component" TODO is confirmed unresolved here.

2. **`createSession` does not emit a GRANTED audit event.** `session-manager.mjs:145-183` validates token, checks scopes, persists row, starts polling — and never calls `publishAuthDecisionFn`. Meanwhile `validate-subscription-auth.mjs:137-146` always emits GRANTED on success. Two ways to open a session, one of which is silent in the audit trail.

3. **`createSession` denial throws without auditing.** `session-manager.mjs:149-153` throws a bare `Error` with `code: 'INSUFFICIENT_SCOPE'`. No `publishAuthDecisionFn({ action: 'DENIED', … })` call. A revocation/denial via this path leaves no audit trail.

4. **`refreshToken` re-validates token signature but does not re-check scopes.** `session-manager.mjs:185-232` calls `validateTokenFn` and sets `status = 'ACTIVE'`, but does not call `checkScopesFn`. A new token issued before scopes-were-revoked-but-after-key-rotation would resume the session; even a current token whose claims lack the required scope will resume to ACTIVE until the next poll fires (up to `SCOPE_REVALIDATION_INTERVAL_SECONDS` later). The act of refreshing should re-prove authorization, not just freshness.

5. **`MAX_SUBSCRIPTIONS_PER_WORKSPACE` is enforced per-actor, not per-workspace.** `validate-subscription-auth.mjs:8-20` — the SQL filters `AND actor_identity = $3`. The env var name says "per workspace"; the implementation says "per actor in workspace". A 50-subscription cap therefore allows each user 50 sessions, and a 1000-user workspace can hold 50 000 sessions.

6. **Default `introspectTokenFn` is a stub returning empty scopes.** `session-manager.mjs:11` — `introspectTokenFn = async () => ({ active: true, scopes: [] })`. The real introspector at `token-validator.mjs:127-151` is enclosed in the validator factory and never exported. A consumer that constructs the session manager without overriding `introspectTokenFn` will, on every poll cycle, call `checkScopesFn` with `scopes: []`, which (per the `realtime:read` fallback at `scope-checker.mjs:69`) will deny unless the workspace happens to have no mappings and the token grants `realtime:read` — and even then the token's real scopes are not consulted. Any deployment that ships defaults is broken.

7. **Session manager has no recovery on process restart.** The `activeSessions` Map and the `setInterval` timers live in memory. Postgres `realtime_sessions` rows remain `status='ACTIVE'` across restarts but the polling cycle that enforces scope revocation dies with the process. There is no startup hook that reads ACTIVE sessions and re-attaches pollers, nor a cron sweep that marks orphaned sessions stale.

8. **No SIGTERM/`beforeExit` hook calls `shutdown()`.** A consumer that forgets to wire `shutdown` leaks all interval timers on process exit.

9. **`shutdown()` does not flip DB rows to `'CLOSED'`.** `session-manager.mjs:246-253` only mutates in-memory state. Postgres still believes the sessions are ACTIVE after `shutdown()` — combined with gap #7, dead sessions accumulate.

10. **Audit-publisher Kafka send happens before the Postgres insert.** `audit-publisher.mjs:153-171` — Kafka first, DB second. The Postgres failure is swallowed (`:172-174`). The system can emit a Kafka audit event with no corresponding `realtime_subscription_auth_records` row. Auditors who reconcile the two stores will see drift.

11. **`audit-publisher.mjs` schema doesn't enumerate denial codes.** `denialReason` is `{ type: 'string' }`. The code emits the literals `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `INSUFFICIENT_SCOPE`, `INVALID_FILTER`, `QUOTA_EXCEEDED` (across `validate-subscription-auth.mjs`), but a typo would slip past validation. Compare with `suspensionReason` which is enumerated as `['TOKEN_EXPIRED', 'SCOPE_REVOKED']` (`audit-publisher.mjs:37-40`).

12. **`realtime_subscription_auth_records` has no `suspension_reason` column.** Migration 002 only has `denial_reason`. `auth-record-repository.mjs:34` stores `record.denialReason ?? record.suspensionReason ?? null` into `denial_reason`. A SUSPENDED record therefore stores its `'TOKEN_EXPIRED'` / `'SCOPE_REVOKED'` reason in a column literally named "denial_reason" — semantic conflation in the schema.

13. **`realtime_sessions` lacks a uniqueness constraint on `token_jti`.** Migration 003 indexes `(token_jti)` for lookup speed but no `UNIQUE`. The same JWT (same `jti`) can be used to open multiple sessions. Token-replay protection is missing at the persistence layer.

14. **`realtime_sessions` lacks an index on `(tenant_id, workspace_id, actor_identity)`** — exactly the columns `countActiveSubscriptions` queries (`validate-subscription-auth.mjs:8-20`). At scale every subscription request scans by status only.

15. **Scope-mapping cache TTL = revalidation interval (default 30s).** `scope-checker.mjs:34, 42`. If an admin removes a scope mapping to revoke channel access, callers continue to be granted for up to 30s. There's no invalidation hook from `upsertScopeMapping` (`scope-mapping-repository.mjs:26-52`).

16. **`scope-checker` "no mappings → allow if `realtime:read`" is allow-open-by-default.** `scope-checker.mjs:67-75`. An admin who clears all mappings inadvertently broadens access to anyone holding `realtime:read`, which is the OAuth-style default scope. The map's promise that this library enforces scope is undermined by this fail-open default.

17. **No validation of `params.workspaceId` in the validate-subscription-auth action.** A missing `workspaceId` falls through to `hasWorkspaceAccess`, which returns `false` and emits a DENIED with `denialReason: 'INSUFFICIENT_SCOPE'` / `missingScope: 'workspace-access'`. The error is correct but misleading — the real problem is malformed input.

18. **`extractToken` is case-sensitive.** `token-validator.mjs:19` matches only `'Bearer '` (capital B). RFC 6750 §2.1 says the scheme is case-insensitive. `'bearer xxx'` ends up being interpreted as the entire token, then fails JWT-header decoding with `TOKEN_INVALID` — an interop bug for clients that lowercase their auth headers.

19. **Tenant/workspace guard is silent on failure.** `isolation/tenant-workspace-guard.mjs:1-4` returns `false` if either id is missing or mismatched. Nothing logs or audits the rejection. If event-gateway routes a misrouted event, the drop is invisible.

20. **Tests don't cover the session manager's polling or shutdown paths.** Unit tests exist for `audit-publisher`, `filter-parser`, `filter-evaluator`, `scope-checker`, `token-validator`, and `tenant-workspace-guard`, but no `session-manager.test.mjs` is present under `tests/unit/realtime-gateway/`. Integration tests `subscription-auth-flow.test.mjs` and `event-filter-enforcement.test.mjs` exist but do not exercise (a) the SUSPENDED-then-RESUMED flow via `refreshToken`, (b) timer leaks, (c) introspection-fallback after JWKS refresh.

21. **`handle-scope-revocation` action signature is workspace-blind.** `handle-scope-revocation.mjs:7-16` suspends all `(actor, tenant, ACTIVE)` sessions across every workspace. Probably intentional (a Keycloak scope revocation is realm-wide), but the audit-map's claim of "tenant_workspace" scope mode is contradicted — workspaceId is read off each row only for the emitted event payload, never used to filter.

22. **No batched/streaming variant of audit publisher.** Each grant/deny produces one Kafka send + one DB INSERT. Under burst load (e.g., a fleet of clients reconnecting after a Kafka rebalance), this is N round-trips per event with no batching.

---

## BUGS

### Confirmed (logic clearly wrong)

- **B1. `createSession` issues no GRANTED audit event.**
  `services/realtime-gateway/src/auth/session-manager.mjs:145-183` — successful path inserts the DB row, starts polling, returns the public session — but never calls `publishAuthDecisionFn`. Compare with `services/realtime-gateway/src/actions/validate-subscription-auth.mjs:137-146` which always audits the grant. Auditors who count GRANTED events to detect anomalous session creation will under-count by every `createSession` call.

- **B2. `createSession` denial path throws without auditing.**
  `session-manager.mjs:148-153` — on `scopeCheck.allowed === false` it throws an `Error` with `.code = 'INSUFFICIENT_SCOPE'` and returns. No DENIED audit event is produced.

- **B3. SUSPENDED sessions are never cleaned up; their pollers run forever.**
  `session-manager.mjs:62-82` — `suspendSession` updates DB status and emits an event but does **not** call `clearSessionTimer(session)` and does **not** remove the session from `activeSessions`. The session's `setInterval` keeps firing every `SCOPE_REVALIDATION_INTERVAL_SECONDS`. Each subsequent fire early-returns at `:63-65` (status check inside `suspendSession`) — but only after re-checking expiry, calling `introspectTokenFn` (a network call), and `checkScopesFn` (a possible DB query). Confirmed leak both of timers and of work per cycle. Memory and load both grow with the historical count of SUSPENDED sessions.

- **B4. `refreshToken` does not re-check scopes.**
  `session-manager.mjs:185-214` — calls `validateTokenFn(newBearerToken)` (signature/exp only), assigns `session.claims = claims`, writes DB row with `status = 'ACTIVE'`, restarts polling. No `checkScopesFn` call. A token whose scopes were stripped via Keycloak between the prior session's poll and this refresh will resume to ACTIVE; the violation will only be detected after the next poll, up to `SCOPE_REVALIDATION_INTERVAL_SECONDS` later.

- **B5. `MAX_SUBSCRIPTIONS_PER_WORKSPACE` enforced per-actor rather than per-workspace.**
  `validate-subscription-auth.mjs:8-20` SQL: `WHERE tenant_id=$1 AND workspace_id=$2 AND actor_identity=$3 AND status='ACTIVE'`. The env var name in `env.mjs:15` says "per workspace". The actual enforcement is per `(tenant, workspace, actor)`. With the default of 50, a single workspace with 1000 users can hold 50 000 active sessions.

- **B6. Default `introspectTokenFn` is a no-op stub that breaks polling.**
  `session-manager.mjs:11` — `introspectTokenFn = async () => ({ active: true, scopes: [] })`. Inside `startPolling` at `:117-119`, this gives `introspectedScopes = []`. The poll then calls `checkScopesFn(..., scopes: [])` at `:120-124`. With a workspace that has any scope mapping, `checkScopes` returns `allowed: false` (`scope-checker.mjs:81-94`), causing `suspendSession` on the very first polling tick (`:126-129`). The result: every session created with default wiring auto-suspends within ~30s, regardless of the real token.

- **B7. Audit-publisher Kafka send and DB insert are not atomic.**
  `audit-publisher.mjs:153-174` — Kafka first, DB second, DB failure swallowed (`:172-174`). Result: Kafka audit stream can contain events with no corresponding `realtime_subscription_auth_records` row. There is no compensating action, no DLQ, no retry.

- **B8. `realtime_subscription_auth_records.denial_reason` is overloaded with `suspension_reason`.**
  Migration `002-create-realtime-subscription-auth-records.sql:9` declares only `denial_reason TEXT`. The repository at `auth-record-repository.mjs:34` writes `record.denialReason ?? record.suspensionReason ?? null` into that column. A SUSPENDED row therefore reports its suspension reason in a column literally named "denial_reason". Querying this table cannot tell a denial from a suspension without joining on `action`.

- **B9. `shutdown()` does not flip DB rows to CLOSED.**
  `session-manager.mjs:246-253` — clears timers, sets in-memory `status = 'CLOSED'`, clears the map. No SQL UPDATE. Postgres still reports the rows as ACTIVE for the indefinite future.

### Likely (smells, race conditions, leaks)

- **B10. JWKS client is rebuilt on every signing-key lookup.**
  `token-validator.mjs:115-119` — `jwksClientFactory({...})` is called inside `fetchSigningKey` on every miss. `jwks-rsa` clients carry their own LRU; constructing one per call loses cache hits within the same TTL window. The outer `keyCache` saves the public key but the round-trips to Keycloak when a new `kid` appears are unbatched.

- **B11. `extractToken` only matches `'Bearer '` literally.**
  `token-validator.mjs:19` — `bearerToken.startsWith('Bearer ')`. RFC 6750 says the scheme is case-insensitive (`'bearer'`, `'BEARER'`, etc.). Lowercase clients see their auth header treated as a raw token and fail with `TOKEN_INVALID` rather than authenticate.

- **B12. Process restart strands ACTIVE sessions without pollers.**
  No DB scan in `createSessionManager` to re-attach polling for rows already `status = 'ACTIVE'`. After a restart, scope revocations stop suspending those sessions; the system is silently insecure for those sessions until they expire or are explicitly closed.

- **B13. Scope-mapping cache is in-process and not invalidated by `upsertScopeMapping`.**
  `scope-checker.mjs:30-44` caches per `(tenantId, workspaceId)` with TTL = revalidation interval (default 30s). `scope-mapping-repository.mjs:26-52` writes new mappings without notifying any cache. Up to 30s of stale allow-decisions after a revocation.

- **B14. `realtime_sessions` lacks UNIQUE on `token_jti`.**
  Migration 003 only `CREATE INDEX … (token_jti)`. A token replay can create multiple ACTIVE rows for the same JTI. Combined with B5 (per-actor quota), an attacker can multiply session count by replaying the same token across reconnects.

- **B15. `scope-checker` allow-open fallback when no mappings exist.**
  `scope-checker.mjs:67-75` — a workspace with zero mappings grants any token bearing `realtime:read`. Operators who think "I have not configured channel mappings yet, nothing is reachable" are wrong: anything with the generic `realtime:read` scope is reachable.

- **B16. `audit-publisher` schema's `denialReason` is open-ended.**
  `audit-publisher.mjs:35` — `denialReason: { type: 'string' }`. The code emits a fixed set of literals across `validate-subscription-auth.mjs`, but a typo or future addition is unvalidated. Compare with `suspensionReason` which is enumerated (`:37-40`).

- **B17. Polling-cycle error logger floods on systemic DB outage.**
  `session-manager.mjs:139-141` — every poll cycle catches and logs. With N active sessions and a DB outage, the log volume scales with N × (1/interval). No backoff, no circuit breaker.

- **B18. `closeSession` may race with the in-flight polling tick.**
  `session-manager.mjs:234-244` — clears the timer, then awaits the DB UPDATE, then deletes from the map. If the polling tick was already running when `clearIntervalFn` was called, the in-flight callback can race the UPDATE and overwrite the CLOSED status with another UPDATE at `:132-138`.

### Needs verification (requires running code or larger read)

- **B19. JWKS retry-then-introspect order swallows a real `TOKEN_INVALID` after refresh.**
  `token-validator.mjs:172-182` — if refresh throws a non-`UnknownKidError`, `toAuthError(refreshError)` is thrown. If refresh throws yet another `UnknownKidError`, falls through to introspection. If introspection then *also* succeeds for an expired but introspectable token, the session bypasses the local JWT clock-tolerance check. Need to confirm whether Keycloak's introspection endpoint will return `active: true` for a token whose `exp` already passed (it generally will not, but configuration-dependent).

- **B20. `handle-scope-revocation` workspace-blind suspension.**
  `handle-scope-revocation.mjs:7-16` — suspends every session for `(actor, tenant)` across all workspaces. The capability map describes the library as `tenant_workspace`-scoped. Confirm whether this is the intended semantics (Keycloak realm-wide scope grant) or a bug that should accept an optional `workspaceId` filter.

- **B21. Filter evaluator `contains` semantics.**
  `filter-evaluator.mjs:25-34` — `contains` on a string uses `String.prototype.includes`; on an array uses `Array.prototype.includes` (reference/equality). For nested arrays or non-primitive predicate values, this differs from common SQL `IN`/`@>` semantics. Worth a contract test.

- **B22. `complexity-checker.mjs` only caps predicate count.**
  Maximum predicate count is bounded, but field length, value depth, and regex complexity are unbounded. AJV schema at `filter-parser.mjs:13-39` allows `value: true` (any type), so a deeply nested object could be passed as `value`. Worth verifying whether downstream filter evaluation can be wedged by a deeply nested predicate value.

---

## Scope note for downstream spec authoring

This package is a library, not a service. Its FRs only make sense in the context of a transport — the actual WebSocket/SSE handler in `charts/realtime-gateway/templates/` (APISIX plugin glue). Any OpenSpec proposal that targets B2 should split into:

- **B2-lib**: the library FRs above (token validation, scope check, filter parse, session-manager protocol, audit envelope).
- **B2-transport**: the transport behaviour at `charts/realtime-gateway/templates/`, which is the actual `/realtime` endpoint per the capability map and which is responsible for calling `createSession` / `closeSession` / `refreshToken` and applying `guardEvent` on each broadcast frame.

Several bugs (B1, B2, B7, B12) are jointly owned: the library exposes the primitive, the transport decides whether to call it. They should be specified together.
