## Why

The realtime-gateway session manager has multiple lifecycle leaks: SUSPENDED
sessions keep their pollers running forever, shutdown does not write the
terminal state to Postgres, and process restart strands ACTIVE rows whose
pollers have died. Each leak compounds: long-running deployments accumulate
unbounded SUSPENDED-but-polling sessions and silently-insecure ACTIVE rows.
From `openspec/audit/cap-b2-realtime-auth-scope-validation.md`:

- **B3** (`services/realtime-gateway/src/auth/session-manager.mjs:62-82`) —
  `suspendSession` updates DB status and emits an event but never calls
  `clearSessionTimer(session)` and never removes the session from
  `activeSessions`. The `setInterval` keeps firing every
  `SCOPE_REVALIDATION_INTERVAL_SECONDS`. Each fire calls `introspectTokenFn`
  (network) and `checkScopesFn` (possible DB query) before the status guard
  short-circuits. Both memory and load grow with the historical SUSPENDED
  count.
- **B9** (`session-manager.mjs:246-253`) — `shutdown` clears timers, sets
  in-memory `status = 'CLOSED'`, and clears the map. No SQL UPDATE. Postgres
  still reports the rows ACTIVE indefinitely.
- **B12** — no DB scan in `createSessionManager` to re-attach polling for rows
  already `status = 'ACTIVE'`. After a process restart, scope revocations stop
  suspending those sessions; the system is silently insecure until they
  expire or are explicitly closed.
- **B17** (`session-manager.mjs:139-141`) — every poll cycle catches and logs;
  with N active sessions and a DB outage, log volume scales N × (1/interval).
  No backoff, no circuit breaker.
- **G7** — same as B12.
- **G9** — same as B9.

## What Changes

- Fix `suspendSession` at `session-manager.mjs:62-82` to call
  `clearSessionTimer(session)` AND remove the session from `activeSessions`
  BEFORE emitting the suspension event.
- Fix `shutdown` at `:246-253` to issue a bulk SQL `UPDATE realtime_sessions
  SET status='CLOSED' WHERE id = ANY($1)` covering every in-memory id before
  clearing the map.
- Add a `recoverActiveSessionsOnStartup()` function called from
  `createSessionManager` that SELECTs `realtime_sessions` rows with
  `status='ACTIVE'` for this transport instance and re-attaches polling (or
  marks them `'CLOSED'` if reattachment is impossible — e.g. token cannot be
  re-introspected).
- Add a polling-cycle circuit breaker: after K consecutive cycle failures, the
  manager logs once at WARN and pauses the poll for an exponentially-growing
  interval rather than every cycle logging at ERROR.

## Capabilities

### Modified Capabilities

- `identity-and-access`: session-lifecycle invariants for SUSPENDED, CLOSED,
  process restart, and polling-cycle failure handling.

## Impact

- Affected code:
  `services/realtime-gateway/src/auth/session-manager.mjs`,
  `services/realtime-gateway/src/auth/session-recovery.mjs` (new).
- Migrations: none (schema unchanged).
- Breaking changes: consumers relying on `activeSessions.get(sessionId)`
  returning a SUSPENDED entry after `suspendSession` will now get `undefined`
  — intended; they MUST use the DB row to read the SUSPENDED state.
- Out of scope: audit-emission asymmetry (covered by
  `fix-b2-audit-emission-asymmetry`); token/scope re-validation
  (covered by `harden-b2-token-and-scope-validation`).
