## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/workspace-docs-service/src/doc-assembler.test.mjs` that
      schedules an upstream resolution AFTER the 2s timeout fires; assert
      `withTimeout` cancels the upstream via `AbortSignal` and that no
      handle keeps the event loop alive.
- [ ] 1.2 [test] Add a case where `internalClient.getApiSurface` rejects
      with `{ statusCode: 503, code: 'UPSTREAM_UNAVAILABLE',
      cause: 'auth_failed' }`; assert the assembler propagates 401/403,
      NOT the degraded `stale: true` response.
- [ ] 1.3 [test] Add a case where `listNotes` returns 250 rows; assert
      the response carries the first 50 with a non-empty `nextPageToken`.
- [ ] 1.4 [test] Add a case constructing the assembler with
      `internalClient = {}`; assert the call throws
      `INTERNAL_CLIENT_MISCONFIGURED` with the missing-method list.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `withTimeout` at `doc-assembler.mjs:5-23` to
      `Promise.race` against a timer that calls `abortController.abort()`
      on fire; clear the timer in `.finally`; pass the `AbortSignal` to
      `internalClient` calls at `:40-41`.
- [ ] 2.2 [fix] Narrow the degradation branch at `doc-assembler.mjs:68-83`
      to require `code === 'UPSTREAM_UNAVAILABLE'` AND
      `cause !== 'auth_failed'`; re-throw the original error otherwise.
- [ ] 2.3 [fix] Add pagination in `note-repository.mjs:44-54`
      (`limit`/`cursor`); thread the cursor through
      `doc-assembler.mjs:44-45` into the response payload.
- [ ] 2.4 [fix] Add an entry-point assertion in
      `doc-assembler.mjs:40-41` validating `internalClient` exposes
      `getApiSurface` and `getEffectiveCapabilities`; throw
      `INTERNAL_CLIENT_MISCONFIGURED` on miss.
- [ ] 2.5 [fix] Replace the hardcoded `2000` ms timeout with
      `config.upstreamTimeoutMs` from `WORKSPACE_DOCS_UPSTREAM_TIMEOUT_MS`
      (default 2000); plumb through `validateRuntimeConfig`.

## 3. Validation

- [ ] 3.1 [test] Re-run K1 unit + integration suites and `openspec
      validate fix-k1-doc-assembler --strict`; all green.
- [ ] 3.2 [docs] Document pagination semantics in
      `services/workspace-docs-service/README.md`.
