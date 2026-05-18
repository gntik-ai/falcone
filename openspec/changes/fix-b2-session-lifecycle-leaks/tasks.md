## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add
      `services/realtime-gateway/test/unit/session-manager-suspend-leak.test.mjs`
      that calls `suspendSession` then advances fake timers by 10 cycles;
      assert `introspectTokenFn`/`checkScopesFn` are NOT invoked after
      suspension, proving B3 from `session-manager.mjs:62-82`.
- [ ] 1.2 [test] Add a case for `shutdown()` at `:246-253`: assert the bulk
      `UPDATE realtime_sessions SET status='CLOSED'` fires before the map is
      cleared, proving B9/G9.
- [ ] 1.3 [test] Add
      `services/realtime-gateway/test/unit/session-recovery.test.mjs`: seed
      the DB with one ACTIVE row, construct the manager, assert recovery
      re-attaches polling (or marks CLOSED if reattachment fails), proving
      B12/G7.
- [ ] 1.4 [test] Add a case that triggers 5 consecutive poll-cycle DB
      failures; assert exactly one WARN log and an exponentially-growing
      pause, proving B17 from `session-manager.mjs:139-141`.

## 2. Implementation

- [ ] 2.1 [fix] Update `suspendSession` at `session-manager.mjs:62-82` to
      call `clearSessionTimer` and `activeSessions.delete(sessionId)` BEFORE
      emitting the audit event.
- [ ] 2.2 [fix] Update `shutdown` at `:246-253` to issue
      `UPDATE realtime_sessions SET status='CLOSED' WHERE id = ANY($1)`
      covering every in-memory session id before clearing the map.
- [ ] 2.3 [impl] Add
      `services/realtime-gateway/src/auth/session-recovery.mjs` exporting
      `recoverActiveSessionsOnStartup(deps)`; call it from
      `createSessionManager`.
- [ ] 2.4 [impl] Add a polling-cycle circuit breaker around
      `session-manager.mjs:139-141`: track consecutive failures, pause the
      poll after K failures with exponential backoff, resume on first success.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the lifecycle invariants and the recovery contract
      in `services/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate fix-b2-session-lifecycle-leaks --strict`; both green.
