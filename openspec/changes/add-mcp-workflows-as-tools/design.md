## Context

Flows (ADR-11) are durable Temporal workflows with a versioned definition and an executions API; long-running by nature. The MCP **Tasks extension** (2026-07-28 RC) models exactly this: a tool call returns a Task that the client polls/streams to a terminal state. So a published flow maps to a long-running MCP tool, and a flow execution maps to an MCP Task.

## Goals / Non-Goals

**Goals:** a pure mapping (flow→tool, invoke→Task handle, execution-status→Task-status) reusing the flows executions API + monitoring; a live proof of the Task lifecycle against real Temporal.

**Non-Goals:** new flow/DSL features; the worker/Temporal internals; the console (#397); re-implementing flow execution (it rides the existing flow-executor + worker).

## Decisions

- **Flow = long-running tool; execution = Task.** `flowToMcpTool` emits a tool with the flow's input schema, `longRunning: true`, `mutates: true`, and a per-tool scope. Invoking starts an execution (`POST …/executions`) and returns a Task handle = the `executionId`. Rationale: the durable run id is a perfect Task id; the agent reconnects/polls statelessly.
- **Status mapping.** Flow execution states map to MCP Task states: running→`working`, completed→`completed` (+ result), failed→`failed` (+ error), cancelled→`cancelled`. Read via `GET …/executions/{executionId}`; live updates via the existing `…/events` SSE (`flow-monitoring-executor`).
- **No synchronous hold.** The tool call returns immediately with the Task handle; long execution never holds a connection (stateless core, #387 tenet).
- **Tenancy.** The flow/execution are tenant/workspace-scoped by the credential (ADR-2); the tenant is never a tool argument; flow quotas (`flow-quota-gate`) apply.
- **RC caution.** The Tasks-extension field names are provisional (2026-07-28 RC); keep the mapping in one module so the wording can be re-pinned when the spec finalizes.

## Risks / Trade-offs

- *Tasks extension churn (RC)* → isolate the mapping; verify against the official spec before GA.
- *Temporal not on the kind cluster* → the live spike deploys a Temporal dev server to prove the start→poll→completed lifecycle; production rides the chart's Temporal (ADR-11) + worker.

## Migration Plan

Additive: pure mapping module + tests; wired into the official/instant servers when flows are published. Live spike is throwaway (`spikes/`).

## Open Questions

- Whether to expose `cancel`/`signal` as companion tools (the executions API supports `…/cancellations`, `…/signals/{name}`) — start with run + status; add control tools later.
- Final Tasks-extension field names once 2026-07-28 ships.
