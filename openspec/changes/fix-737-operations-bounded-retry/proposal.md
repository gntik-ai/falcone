# fix-737-operations-bounded-retry

## Why

The web console operations page (`/console/operations`) can enter an immediate retry storm when
`POST /v1/async-operation-query` fails. The operations page passes a fresh pagination object into
`useOperations` on every render. `useAsyncResource` depends on the request factory identity, so the
error-state update causes a rerender, the request factory changes, the effect runs again immediately,
and the same failing request repeats without a bounded retry budget or backoff.

This makes a backend error amplify into thousands of identical failed requests and prevents the page
from settling into its existing error state with the manual **Reintentar** control.

## What Changes

- `apps/web-console/src/lib/console-operations.ts`
  - Stabilizes async resource execution around the semantic `dependencyKey`, not the request
    factory function identity, so harmless caller object identity changes do not retrigger a load.
  - Adds a small bounded retry budget for async-resource failures: two retries with 1s then 3s
    backoff, then the hook stops and exposes the error.
  - Normalizes pagination from scalar `limit` / `offset` values so object literals with the same
    values do not create new pagination dependencies on every render.
- `apps/web-console/src/lib/console-operations.test.ts`
  - Adds a RED/GREEN hook regression for a persistent `async-operation-query` failure while the
    caller passes a fresh pagination literal each render. The fixed behavior makes exactly three
    requests total (initial + two retries), then exposes the error and stays quiet even after more
    timer time elapses.
- `apps/web-console/src/pages/ConsoleOperationsPage.test.tsx`
  - Asserts the operations page renders its error state and wires the manual **Reintentar** action
    to the hook's manual retry callback.
- `docs/reference/architecture/console-operations-polling.md`
  - Documents the operations polling and error retry contract.
- `openspec/changes/fix-737-operations-bounded-retry/specs/web-console/spec.md`
  - Adds the acceptance requirement and WHEN/THEN scenario under the `web-console` capability.

## Scope

This is a frontend-only resilience fix. It does not change any backend route, OpenAPI document,
generated SDK/type artifact, route catalog entry, or request/response schema.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement for operations polling resilience. Issue #737 proposed this
  as `## MODIFIED Requirements`, but this worktree has no base
  `openspec/specs/web-console/spec.md` requirement covering operations polling failure behavior, so
  the valid OpenSpec delta is authored as `## ADDED Requirements` under the `web-console`
  capability.
