## 1. Test scaffolding

- [ ] 1.1 [test] Add
      `services/realtime-gateway/test/fixtures/session-manager-deps.mjs`
      exporting a `createDepsFixture({...overrides})` factory that returns
      injectable stubs for `validateTokenFn`, `introspectTokenFn`,
      `checkScopesFn`, `publishAuthDecisionFn`, `setIntervalFn`,
      `clearIntervalFn`, and a fake Postgres adapter — sufficient to drive
      the session-manager state machine deterministically.

## 2. Coverage of the session-manager state machine

- [ ] 2.1 [test] Add
      `services/realtime-gateway/test/unit/session-manager.test.mjs` with a
      case covering `createSession` success: assert DB INSERT, timer attached,
      and (post-`fix-b2-audit-emission-asymmetry`) a `GRANTED` event.
- [ ] 2.2 [test] Add a case covering `createSession` scope-denial: assert
      no DB INSERT and (post-fix) a `DENIED` event.
- [ ] 2.3 [test] Add a case covering the polling cycle's three suspension
      reasons (`TOKEN_EXPIRED` from JWT expiry, `TOKEN_EXPIRED` from
      introspection `active:false` past expiry, `SCOPE_REVOKED` from
      `checkScopesFn`), exercising
      `services/realtime-gateway/src/auth/session-manager.mjs:103-129`.
- [ ] 2.4 [test] Add a case covering `suspendSession` idempotence and (post
      `fix-b2-session-lifecycle-leaks`) timer/memory release.
- [ ] 2.5 [test] Add a case covering `refreshToken`: SUSPENDED→RESUMED path
      with RESUMED audit event.
- [ ] 2.6 [test] Add a case covering `closeSession`: timer cleared, DB UPDATE,
      map deletion in that order; assert race with an in-flight tick.
- [ ] 2.7 [test] Add a case covering `shutdown`: every timer cleared, every
      session marked CLOSED in memory; (post-fix) DB rows flipped to CLOSED.

## 3. Validation

- [ ] 3.1 [test] Run targeted tests +
      `openspec validate coverage-b2-session-manager --strict`; both green.
