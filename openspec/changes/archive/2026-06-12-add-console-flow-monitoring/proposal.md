## Why

Tenants who build workflows with the Temporal-based flow engine (epic #355) have no visibility into running or completed executions: there is no live per-node status feed, no run-history list, and no way to cancel, retry, or approve a human-approval node from the web console. This change delivers execution observability as the final consumer-facing layer of the engine.

## What Changes

- New SSE endpoint `GET /v1/flows/workspaces/{workspaceId}/executions/{executionId}/events` implemented via the existing `runRealtimeSse` pattern (`apps/control-plane/src/runtime/server.mjs::runRealtimeSse`): 25 s pings, `X-Accel-Buffering: no`, `retry: 3000`, `?apikey=` query-param auth for `EventSource`, strictly tenant-scoped (the resolved identity's `tenantId` must own the execution's `workspaceId`). The backend flow executor polls Temporal history, maps events to DSL node IDs via the #359 naming convention, and emits typed SSE frames (`node-status`, `log-line`).
- New console run-view page: the #363 designer canvas placed in read-only run mode, per-node status badges (scheduled / started / retrying / completed / failed / skipped), attempt counts, durations; clicking a node opens a detail panel with size-capped input/output payload, final error, and attempt history.
- New console run-history list: filterable by `flowId`, `flowVersion`, status, `triggerType`, time range via the #361 list endpoint; client-side pagination.
- Mutation actions from the run view: cancel (graceful), retry (new run, same version + input), send approval signal for human-approval nodes — all via #361 endpoints, each behind a confirmation dialog; actions are audited.
- Completed / terminated runs render from persisted history without requiring a live stream.
- New Vitest component tests for the above views (must pass; broken-baseline rule: new tests must pass without widening the set of pre-existing failures).

## Capabilities

### New Capabilities

- `workflows`: execution observability — SSE event stream, run-view canvas overlay, run-history list, cancel/retry/signal actions, completed-run replay from persisted history.

### Modified Capabilities

(none — all workflows requirements are new)

## Impact

- **Backend**: new SSE route and flow-history-to-SSE mapping logic in `apps/control-plane/src/runtime/` (route table in `server.mjs`, new `flow-monitoring-executor.mjs`). Depends on sibling changes: #359 (DSL node-ID naming convention), #361 (flows control-plane API), #363 (canvas component).
- **Console**: new pages `ConsoleFlowRunPage` and `ConsoleFlowHistoryPage` in `apps/web-console/src/pages/`; new service `flowsMonitoringApi.ts` mirroring `realtimeApi.ts` (`apps/web-console/src/services/realtimeApi.ts`). Re-uses `EventSource` subscription pattern from `apps/web-console/src/services/realtimeApi.ts::subscribeRealtimeChanges`.
- **Security / tenant isolation**: the SSE endpoint is a classic cross-tenant leakage vector; `identity.tenantId` must be verified against the execution's workspace before the stream is opened — same pattern as `runRealtimeSse` which passes `identity` into the executor's `subscribe` call (`apps/control-plane/src/runtime/server.mjs:355`).
- **Tests**: new Vitest unit/component tests; cross-tenant probe required in the black-box contract suite.
- **Dependencies**: Temporal SDK (already required by sibling changes #359/#361); no new external deps for the console.
