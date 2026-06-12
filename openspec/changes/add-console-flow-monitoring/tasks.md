## 1. Backend SSE executor

- [ ] 1.1 Create `apps/control-plane/src/runtime/flow-monitoring-executor.mjs` with a `subscribe({ workspaceId, executionId, identity, signal, onEvent, onError })` interface
- [ ] 1.2 Implement tenant-isolation check in the executor: verify `identity.tenantId` matches the workspace's tenant before opening the Temporal history poll; throw `{ statusCode: 403, code: 'FORBIDDEN' }` on mismatch
- [ ] 1.3 Implement Temporal history poll loop using `WorkflowService.getWorkflowExecutionHistory` long-poll; translate `ActivityTask*` and `TimerFired` events to `node-status` SSE frames using the #359 node-ID naming convention
- [ ] 1.4 Implement `log-line` SSE frame emission from activity log payloads
- [ ] 1.5 Implement terminal-state replay: emit all persisted history events then send `event: stream-end` when execution is already in a terminal state
- [ ] 1.6 Implement `Last-Event-ID` resume: skip events with sequence number <= the value of the `Last-Event-ID` header

## 2. Backend SSE route registration

- [ ] 2.1 Add `flowMonitoringExecutor` parameter to `buildRoutes` and `createControlPlaneServer` in `apps/control-plane/src/runtime/server.mjs`
- [ ] 2.2 Register SSE route `['GET', /v1\/flows\/workspaces\/([^/]+)\/executions\/([^/]+)\/events$/, handler, { sse: true }]` in the route table, calling `runRealtimeSse` with the flow-monitoring executor
- [ ] 2.3 Inject `flow-monitoring-executor.mjs` in `apps/control-plane/src/runtime/main.mjs`, gated on `FLOWS_ENABLED` env flag; return 501 when absent

## 3. Console service layer

- [ ] 3.1 Create `apps/web-console/src/services/flowsMonitoringApi.ts` exporting `flowExecutionEventsUrl` and `subscribeFlowExecution` mirroring the shape of `realtimeApi.ts::subscribeRealtimeChanges`
- [ ] 3.2 Define TypeScript interfaces `NodeStatusEvent`, `LogLineEvent`, `FlowExecutionSubscription` in `flowsMonitoringApi.ts`
- [ ] 3.3 Create `apps/web-console/src/lib/hooks/use-flow-execution.ts` React hook that opens the SSE subscription on mount, accumulates node-status events into a `Map<nodeId, NodeStatus>`, closes on unmount

## 4. Console run-view page

- [ ] 4.1 Create `apps/web-console/src/pages/ConsoleFlowRunPage.tsx` placing the #363 canvas in read-only run mode
- [ ] 4.2 Implement per-node status badge overlay: status label, attempt count (when > 1), elapsed/total duration derived from SSE event timestamps
- [ ] 4.3 Implement node detail panel: size-capped (4 KB) input/output JSON display, error message + stack excerpt, chronological attempt list
- [ ] 4.4 Handle completed/terminal runs: detect `stream-end` event and transition canvas to static display mode, rendering all final node statuses from accumulated history
- [ ] 4.5 Register the run-view page route in `apps/web-console/src/router.tsx`

## 5. Console run-history list page

- [ ] 5.1 Create `apps/web-console/src/pages/ConsoleFlowHistoryPage.tsx` with filter controls for `flowId`, `flowVersion`, status, `triggerType`, `startedAfter`, `startedBefore`
- [ ] 5.2 Implement pagination using the continuation token from the #361 list endpoint response
- [ ] 5.3 Implement empty-state message when no executions match the applied filters
- [ ] 5.4 Register the history page route in `apps/web-console/src/router.tsx`

## 6. Console mutation actions

- [ ] 6.1 Implement Cancel action: confirmation dialog, call #361 cancel endpoint on confirm, optimistically update UI status, emit audit entry
- [ ] 6.2 Disable Cancel button when execution is in a terminal state
- [ ] 6.3 Implement Retry action: confirmation dialog, call #361 new-run endpoint with same `flowId`/`flowVersion`/input on confirm, navigate to new run view, emit audit entry
- [ ] 6.4 Hide Retry action when execution is non-terminal
- [ ] 6.5 Implement Approval signal action: confirmation dialog identifying node and signal type, call #361 approval-signal endpoint on confirm, update node badge, emit audit entry
- [ ] 6.6 Hide approval/rejection controls when node is not in `waiting-approval` status

## 7. Tests

- [ ] 7.1 Add Vitest unit tests for `flow-monitoring-executor.mjs`: tenant isolation check, history-to-SSE mapping for all six node statuses, terminal-state replay, `Last-Event-ID` resume
- [ ] 7.2 Add Vitest component tests for node-status badge: renders correct label and styling for each of the six status values
- [ ] 7.3 Add Vitest component test for `use-flow-execution` hook: confirms `EventSource` is closed on unmount and no state updates are dispatched after unmount
- [ ] 7.4 Add Vitest component tests for run-history list: each filter field updates the query params; empty-state renders when result set is empty
- [ ] 7.5 Add Vitest component tests for Cancel/Retry/Approval confirmation dialogs: dialog appears before API call; API call fires only on confirm; button is disabled/hidden in the correct states
- [ ] 7.6 Add cross-tenant SSE probe to `tests/blackbox/`: authenticate as tenant A, request the SSE stream for tenant B's execution, assert HTTP 403
