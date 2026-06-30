# Tasks - fix-737-operations-bounded-retry

## 1. Reproduce / encode the bug

- [x] Confirm the retry storm root cause on `origin/main`: `/console/operations` passes
      `{ limit: PAGE_SIZE, offset }` as a fresh object each render; `useAsyncResource` depends on
      `requestFactory`; an error sets hook state, rerenders, changes the factory identity, and
      immediately re-enters the effect.
- [x] Add a regression test for persistent `async-operation-query` failure that uses a fresh
      pagination literal and asserts the request count remains bounded.
- [x] Assert the operations page renders the error state with the manual **Reintentar** action
      wired to the hook refetch callback.

## 2. Fix

- [x] Make `useAsyncResource` trigger loads by semantic dependency key and manual reload token, not
      by request factory identity.
- [x] Add a bounded retry budget with backoff before exposing the final error state.
- [x] Normalize pagination from scalar values so stable `limit` / `offset` inputs are stable even
      when callers pass object literals.

## 3. Scope / wire / docs

- [x] Keep the change frontend-only: no backend, OpenAPI, SDK, route catalog, or API schema change.
- [x] Add documentation for console operations polling and error retry behavior.
- [x] Materialize this OpenSpec delta under `openspec/changes/fix-737-operations-bounded-retry/`
      as `## ADDED Requirements`; there is no base `openspec/specs/web-console/spec.md`
      operations-polling requirement to modify.

## 4. Verify

- [x] Run the focused web-console test for `console-operations`.
- [x] Run the relevant web-console regression slice covering the operations page error state.
- [x] Attempt the web-console typecheck; local typecheck remains blocked by unrelated pre-existing
      errors outside this change.
- [x] Confirm the diff contains no contract/generated/backend drift.
