## 1. Flow → MCP tool mapping

- [x] 1.1 `flowToMcpTool(flow)` → tool { name `run_flow_<flow>`, description, inputSchema = flow input contract, mutates:true, longRunning:true, scope, source } targeting `POST /v1/flows/workspaces/{ws}/flows/{flowId}/executions`
- [x] 1.2 `buildStartExecutionCall(flow, args, ctx)` shape: returns the start call + `taskHandleFromExecution` keyed by `executionId` (no synchronous hold); tenant credential-derived, never from args
- [x] 1.3 `mapExecutionToTaskStatus(execution)` → MCP Task status (running→working, completed→completed+result, failed→failed+error, cancelled→cancelled)

## 2. Verify (unit + LIVE Temporal)

- [x] 2.1 Unit tests: flow→tool (long-running, input schema, scope); status mapping for each terminal state; tenant-from-args ignored
- [x] 2.2 LIVE on `test-cluster-b`: deployed a Temporal dev server (Server 1.31.1) and drove it with `@temporalio/client`; a tool invocation started a durable workflow, the Task handle was the workflow id, and the live `RUNNING` status mapped to the MCP Task `working` state (start → Task handle → poll → status). No worker on the `flows` queue, so `RUNNING→working` is the bounded proof state; the completed/failed/cancelled branches are unit-tested and ride the real worker (ADR-11). Namespace torn down. Evidence: `spikes/add-mcp-workflows-as-tools/evidence/flow-task-lifecycle.txt`
- [x] 2.3 `pnpm lint` + `openspec validate --strict` pass

## 3. Finalize

- [x] 3.1 Tasks-extension field names are provisional (2026-07-28 RC) and isolated in one module (`mcp-workflows-tools.mjs`) with a header note so they can be re-pinned when the spec finalizes; transport pinned to 2025-11-25 stable
