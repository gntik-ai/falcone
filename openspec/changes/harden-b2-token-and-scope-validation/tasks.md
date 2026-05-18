## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add
      `services/realtime-gateway/test/unit/session-manager-refresh-scopes.test.mjs`
      that mints a fresh token whose scopes were revoked; assert `refreshToken`
      denies before flipping to ACTIVE, proving B4 from
      `session-manager.mjs:185-214`.
- [ ] 1.2 [test] Add
      `services/realtime-gateway/test/unit/quota-per-workspace.test.mjs` with
      51 sessions across 2 actors in one workspace under a 50-cap; assert the
      51st is denied with `QUOTA_EXCEEDED`, proving B5 from
      `validate-subscription-auth.mjs:8-20`.
- [ ] 1.3 [test] Add a case constructing `createSessionManager` without
      `introspectTokenFn`; assert construction throws, proving B6 from
      `session-manager.mjs:11`.
- [ ] 1.4 [test] Add a case that allows scope X, then writes an
      `upsertScopeMapping` removing X, then calls the checker within the cache
      TTL; assert the new state is observed immediately, proving B13 from
      `scope-checker.mjs:30-44`.
- [ ] 1.5 [test] Add a case with zero mappings for a workspace and a token
      bearing `realtime:read`; assert the checker DENIES, proving B15 from
      `scope-checker.mjs:67-75`.

## 2. Implementation

- [ ] 2.1 [fix] Update `refreshToken` at `session-manager.mjs:185-214` to
      re-call `checkScopesFn`; on failure emit `DENIED` and call
      `suspendSession` instead of flipping to ACTIVE.
- [ ] 2.2 [fix] Rewrite the active-subscription quota query at
      `validate-subscription-auth.mjs:8-20` to count
      `WHERE tenant_id=$1 AND workspace_id=$2 AND status='ACTIVE'`; remove
      `AND actor_identity = $3`.
- [ ] 2.3 [fix] Remove the default no-op `introspectTokenFn` at
      `session-manager.mjs:11`; make the parameter required and throw if
      omitted.
- [ ] 2.4 [fix] Add a version-counter cache-invalidation hook in
      `scope-mapping-repository.mjs:26-52`; bump the counter on every
      `upsertScopeMapping` and check it on every `scope-checker` read.
- [ ] 2.5 [fix] Replace the allow-open fallback at `scope-checker.mjs:67-75`
      with a fail-closed deny; emit `INSUFFICIENT_SCOPE` with
      `missingScope: '<channel-type>'`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the introspector requirement, fail-closed default,
      and per-workspace quota in `services/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate harden-b2-token-and-scope-validation --strict`; both
      green.
