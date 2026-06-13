## Why

Falcone already ships tenant **Flows** (durable Temporal workflows): a published flow has a versioned definition and an executions API (`/v1/flows/workspaces/{ws}/flows/{flowId}/executions`, `…/executions/{executionId}`, `…/events` SSE), executed by the worker (`services/workflow-worker`) and monitored via `flow-monitoring-executor`. Exposing a published flow as an **MCP tool** — using the spec's **Tasks extension** for the long-running execution — is a synergy no other BaaS has: an agent calls a tool, a durable workflow runs, and the agent polls/streams the task to completion. It resolves issue **#395** (epic #386); builds on the official/instant servers (#391/#392), the gateway (#389) and OAuth (#390).

## What Changes

- **Map a published flow → an MCP tool**: `flowToMcpTool(flow)` → a tool whose input schema is the flow's input contract, marked **long-running** (executes via the Tasks extension), `mutates: true`, with a per-tool scope.
- **Invoke = start a Task**: calling the tool issues `POST …/executions` and returns an MCP **Task** handle keyed by the `executionId` (the durable workflow run id) — it does **not** hold a synchronous connection (stateless-friendly).
- **Poll/stream status**: map a flow execution's status to MCP Task status (`working` / `completed` / `failed` / `cancelled`), reading `GET …/executions/{executionId}` (and the existing `…/events` SSE / `flow-monitoring-executor`), returning the structured result on completion.
- Respect flow quotas/tenancy (`flow-quota-gate`) and the credential-derived tenant (the tenant is never a tool argument).
- **Spec note**: the Tasks extension is in the **2026-07-28 RC**; build against it provisionally and verify the wording before locking the contract (pin to the 2025-11-25 stable transport).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add workflows-as-tools — a published Temporal flow is exposed as a long-running MCP tool whose invocation starts a durable execution and maps to an MCP Task (start → poll/stream status → result). Builds on the foundational `mcp` capability (#387).

## Impact

- **Control-plane:** `apps/control-plane/src/mcp-workflows-tools.mjs` (pure mapping: flow→tool, start→Task handle, execution-status→Task-status) + tests. Reuses the flows executions API + `flow-monitoring-executor` / SSE.
- **Live caveat:** Temporal is **not deployed on the kind cluster** by default; the live verification deploys a Temporal dev server and proves the start→poll→completed Task lifecycle against real Temporal.
- **Out of scope:** new workflow features; the flows DSL; operator-only Temporal internals.
