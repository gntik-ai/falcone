## Context

The Temporal-based workflow engine (epic #355) delivers flow execution but no observability layer. The web console has no run view, no history list, and no mutation actions. The existing SSE infrastructure (`apps/control-plane/src/runtime/server.mjs::runRealtimeSse`) and the `EventSource` client pattern (`apps/web-console/src/services/realtimeApi.ts::subscribeRealtimeChanges`) are proven for the realtime capability and are the direct template for this change.

Sibling changes supply: DSL node-ID naming convention (#359), flows control-plane REST endpoints (cancel/retry/signal, #361), and the canvas component (#363). This change depends on all three and must not duplicate their work.

## Goals / Non-Goals

**Goals:**
- Reuse `runRealtimeSse` verbatim for the new endpoint; no new streaming infrastructure.
- Map Temporal history events to SSE frames in a dedicated `flow-monitoring-executor.mjs` that is injected into `buildRoutes` as a new executor parameter.
- Deliver the run-view canvas, run-history list, and mutation actions entirely within `apps/web-console/src/`.
- Tenant isolation: the SSE route validates `identity.tenantId` against the execution's workspace before opening the Temporal history poll loop.

**Non-Goals:**
- Operator-level Temporal Web UI features (raw history JSON, stack trace viewer).
- Grafana / metrics dashboards.
- Log retention policy enforcement.
- Canvas component implementation (owned by #363).
- Flows REST API endpoints (owned by #361).
- DSL node-ID naming convention (owned by #359).

## Decisions

**SSE route registration follows the existing pattern exactly.**
`server.mjs` adds one entry to the route table: `['GET', /v1\/flows\/workspaces\/([^/]+)\/executions\/([^/]+)\/events$/, handler, { sse: true }]`. The `{ sse: true }` option activates `?apikey=` query-param auth and bypasses JSON body parsing, identical to the two existing realtime SSE routes (lines 330-333 of `server.mjs`). Alternatives (WebSocket, long-poll) are rejected because the existing SSE path already handles proxy buffering (`X-Accel-Buffering: no`) and browser reconnect (`retry: 3000`).

**Temporal history poll is encapsulated in `flow-monitoring-executor.mjs`.**
Rather than embedding Temporal SDK calls directly in the route handler, a new executor module exposes a `subscribe({ workspaceId, executionId, identity, signal, onEvent, onError })` interface matching the shape of `realtime-executor.mjs`. This keeps `server.mjs` thin and makes the Temporal integration unit-testable in isolation. The executor polls `WorkflowService.getWorkflowExecutionHistory` with long-poll semantics and translates `ActivityTaskScheduled`, `ActivityTaskStarted`, `ActivityTaskCompleted`, `ActivityTaskFailed`, and `TimerFired` events to the `node-status` SSE frame using the node-ID convention from #359.

**Tenant isolation is fail-closed.**
Before the history poll begins, the executor calls the workspace registry to confirm `identity.tenantId === workspace.tenantId`. On mismatch it throws `{ statusCode: 403, code: 'FORBIDDEN' }`, mirroring how `runRealtimeSse` propagates executor errors as `event: error` frames and closes the stream. This is the same pattern used by `realtime-executor.mjs` which receives `identity` and scopes the Mongo `$match` filter to `fullDocument.tenantId`.

**Console service module mirrors `realtimeApi.ts`.**
A new `apps/web-console/src/services/flowsMonitoringApi.ts` exports `flowExecutionEventsUrl` (builds the URL with `?apikey=`) and `subscribeFlowExecution` (wraps `EventSource`, registers `node-status` and `log-line` listeners, returns `{ close }`). This mirrors `subscribeRealtimeChanges` from `realtimeApi.ts` and keeps the hook layer (`useFlowExecution`) simple.

**Payload display size cap at 4 KB.**
Activity input/output payloads can be arbitrarily large. The node detail panel truncates the rendered JSON at 4 096 characters with a visible indicator. This is a UI-only guard; the backend emits the full payload in the SSE frame (Temporal history already limits payload size via the SDK's data converter).

**Completed run replay.**
When the execution is in a terminal state the SSE handler emits all persisted history events synchronously then sends `event: stream-end` and closes. The console's `subscribeFlowExecution` treats `stream-end` as a signal to call `close()` on the `EventSource`; the run-view page transitions to a static display mode.

## Risks / Trade-offs

- **Temporal SDK availability in control-plane**: the flow-monitoring executor assumes the Temporal SDK is already present (added by #361). If #361 is not merged first, `flow-monitoring-executor.mjs` will fail at import. Mitigation: gate the executor injection in `main.mjs` on an environment flag (`FLOWS_ENABLED`), return 501 when absent.
- **Large history payloads over SSE**: a long-running execution with thousands of activity events will emit a large burst on reconnect replay. Mitigation: the `Last-Event-ID` resume mechanism allows the client to skip already-delivered events; the executor tracks emitted event sequence numbers.
- **Broken Vitest baseline on main**: pre-existing test failures must not be widened. New component tests must be added in isolated `*.test.tsx` files and must not import or modify any currently-failing test modules.
- **Cross-tenant SSE leakage**: the SSE path is the highest-risk tenant-isolation surface for streaming endpoints. The fail-closed tenant check in the executor is the primary guard; the black-box contract suite must include a cross-tenant probe.

## Migration Plan

1. Merge sibling changes #359, #361, #363 first (hard dependencies).
2. Add `flow-monitoring-executor.mjs` to `apps/control-plane/src/runtime/`.
3. Register the new SSE route in `apps/control-plane/src/runtime/server.mjs`.
4. Add `flowsMonitoringApi.ts` and the run-view/history pages to `apps/web-console/src/`.
5. Add Vitest component tests.
6. Add cross-tenant SSE probe to `tests/blackbox/`.
7. Validate with `openspec validate add-console-flow-monitoring --strict`.

No database migrations required. No breaking changes to existing routes or console pages.

## Open Questions

- Should `log-line` events be gated behind a per-tenant log-retention setting, or always emitted? (Resolved at #361 API design time; this change assumes always-emit for now.)
- Maximum reconnect replay window: should the executor cap replay at N events or a time window to protect against very large histories? Deferred to implementation.
