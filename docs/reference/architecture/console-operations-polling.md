# Console Operations Polling

The web console reads async-operation data through `POST /v1/async-operation-query` from
`apps/web-console/src/lib/console-operations.ts`.

`useOperations`, `useOperationDetail`, `useOperationLogs`, and `useOperationResult` use the shared
`useAsyncResource` helper. Resource execution is keyed by the semantic query dependency key plus an
explicit manual reload token. Callers may pass object literals for filters or pagination, but those
object identities must not cause a request loop when the query result updates React state.

For list polling, the console schedules the next successful refresh only when the returned operation
list contains active operations (`pending` or `running`). Detail, logs, and result queries do not
poll by default.

When an async-operation query fails, the helper performs a small bounded retry sequence with backoff:
one retry after 1 second and one retry after 3 seconds. If the query still fails, the hook exposes the
error and stops automatic retries. The operations page renders that error state with the existing
manual **Reintentar** action. Manual retry clears any pending timer and starts a fresh bounded
attempt sequence.

This behavior prevents a backend outage or migration error from amplifying into an unbounded browser
request burst against the gateway or control plane.
