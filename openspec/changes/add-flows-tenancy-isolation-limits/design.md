## Context

Falcone's existing isolation architecture is Postgres RLS-based: `services/adapters/src/tenant-rls-context.mjs::withTenantRlsContext` sets `app.tenant_id` / `app.workspace_id` as session GUCs inside a transaction, and `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql` demonstrates the fail-closed policy idiom (`FORCE ROW LEVEL SECURITY` + `current_setting('app.tenant_id', true)` returning NULL when unset). Identity is resolved exclusively in `apps/control-plane/src/runtime/server.mjs::resolveIdentity`: API key → tenant from verified key record; JWT → claims; gateway headers as fallback. Client-supplied context headers are never trusted after a valid credential is presented.

The `workflows` capability introduces Temporal as a new data plane. Temporal's visibility store and workflow IDs are not Postgres, so the existing RLS mechanism does not apply. The ADR (#356) chooses the tenancy model; this change enforces it regardless of which model is chosen. Both models share the same API-layer enforcement point: the flow executor in `apps/control-plane/src/runtime/` checks identity before every Temporal RPC call.

The quota infrastructure already exists: `services/provisioning-orchestrator/src/actions/quota-enforce.mjs::main` looks up an effective limit from `quota_dimension_catalog`, compares it against observed usage, logs the decision, and emits an enforcement event. Adding `max_flows`, `max_flow_versions`, `max_concurrent_executions`, `flow_starts_per_minute`, and `flow_signal_rate_per_minute` to `quota_dimension_catalog` via a new migration follows the exact pattern of `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql`.

The audit pipeline emits structured events via Kafka (`services/audit/src/contract-boundary.mjs`). The `capabilityEnforcementDeniedEvent` shape there defines the field conventions (`tenantId`, `workspaceId`, `actorId`, `occurredAt`) that the new `flow_lifecycle_event` contract entry follows.

Tenant deletion already has a six-domain `TEARDOWN_PLAN` in `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs`. The `workflows` domain is added as a seventh entry; the same partial-failure / retry / `purge.failed` semantics apply with no structural changes to the sweep action.

## Goals / Non-Goals

**Goals:**
- Enforce the ADR-chosen tenancy model end-to-end: every Temporal visibility query and per-object RPC is filtered/verified at the flow executor before reaching Temporal.
- Generate workflow IDs server-side as `{tenantId}:{workspaceId}:{flowId}:{runUuid}`; intercept mis-prefixed IDs at the API layer before any Temporal call.
- Mint per-execution short-lived tokens scoped to `{ tenantId, workspaceId }` with expiry tied to maximum run duration; validate in activities.
- Seed five quota dimensions and call `quota-enforce` at the flow API boundary for each applicable gate.
- Emit tenant-scoped audit events for all eight flow lifecycle action types.
- Wire a `workflows` applier into `TEARDOWN_PLAN` covering flow_definitions, flow_versions, schedules, and Temporal namespace/executions.
- Deliver a two-tenant black-box probe suite covering all flows routes and execution paths.

**Non-Goals:**
- The flow API route surface itself (owned by `add-flows-control-plane-api`).
- Activity credential usage within worker logic (owned by `add-flows-activity-catalog`).
- Temporal server Helm bootstrap and namespace registration (owned by `add-flows-temporal-helm`).
- Billing/metering (future `cap:billing`).
- Per-tenant Temporal worker pools beyond what the ADR mandates.

## Decisions

### D1 — Tenancy enforcement at the flow executor layer, not Temporal middleware

The flow executor (`apps/control-plane/src/runtime/flow-executor.mjs`, introduced by `add-flows-control-plane-api`) is the sole Temporal client in the control plane. All tenant isolation enforcement lives here rather than in a Temporal interceptor or server-side plugin, because: (a) the control plane already owns the authoritative identity via `resolveIdentity`; (b) Temporal interceptors run inside the Temporal SDK and cannot access the HTTP-layer identity; (c) a single chokepoint is easier to audit than distributed middleware.

Alternatives considered:
- Temporal namespace-level authorization (Temporal Cloud feature, not available on self-hosted): rejected — not portable.
- Per-tenant Temporal interceptors in worker code: rejected — workers do not have access to the HTTP caller's identity at the time of execution dispatch.

### D2 — Shared-namespace model: server-stamps search attributes, never trusts client filters

If the ADR selects shared namespace: the flow executor stamps `tenantId` and `workspaceId` as custom search attributes (registered by `add-flows-temporal-helm::bootstrap job`) at `StartWorkflowOptions.searchAttributes` time. For every `listWorkflows` call the executor constructs a Temporal query string `tenantId = '<caller_tenant>' AND workspaceId = '<caller_workspace>'` from the verified identity, ignoring any query text supplied by the client. Client-supplied `query` parameters are parsed, stripped of any `tenantId`/`workspaceId` clauses, and then AND-joined with the server-injected clause.

### D3 — Namespace-per-tenant model: namespace name is derived, not accepted from clients

If the ADR selects namespace-per-tenant: the flow executor derives the Temporal namespace as `falcone-{tenantId}` from the verified identity. No API parameter can override the namespace. Lazy binding: the executor checks namespace existence (cached per process, TTL 60s) and provisions on first use via the `add-flows-temporal-helm` bootstrap job pattern.

### D4 — Workflow ID prefix check is the outermost gate, before any Temporal RPC

For describe, history, signal, cancel, and retry: the executor parses the workflow ID, extracts the leading `{tenantId}:` segment, and compares it to the caller's authenticated `tenantId` before issuing any Temporal RPC. A mismatch returns HTTP 404 immediately. This prevents Temporal's own error responses (which may confirm or deny existence) from leaking cross-tenant information.

Alternatives considered:
- Let Temporal return "not found" naturally: rejected — Temporal's namespace-level "not found" vs "execution not found" error codes differ in ways that could leak existence information depending on the tenancy model.

### D5 — Per-execution token uses the existing credential-rotation-expiry-sweep pattern

Short-lived tokens are minted by a new `mintExecutionToken(tenantId, workspaceId, expiresAt)` helper and stored in the Temporal workflow's memo (encrypted at rest by Temporal). The `credential-rotation-expiry-sweep` pattern (`services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs`) handles garbage collection of expired tokens. Token validation in activities uses a lightweight HMAC check against a workspace-scoped signing key, consistent with the API key verification path in `resolveIdentity`.

### D6 — Quota dimensions follow the 098-plan-base-limits.sql seed pattern exactly

A new migration `services/provisioning-orchestrator/src/migrations/NNN-flow-quota-dimensions.sql` inserts the five flow quota dimensions into `quota_dimension_catalog` using `ON CONFLICT (dimension_key) DO NOTHING`. Default values are conservative: `max_flows=50`, `max_flow_versions=20` (per flow), `max_concurrent_executions=10`, `flow_starts_per_minute=60`, `flow_signal_rate_per_minute=120`. These follow the same `unit='count'` convention as all existing dimensions.

### D7 — workflows teardown applier mirrors the functions-applier interface

The new `services/provisioning-orchestrator/src/appliers/workflows-applier.mjs` exports `teardown(tenantId, domainData, { dryRun, credentials, log })` returning `{ status, resource_results }` — the same shape as `iam-applier`, `functions-applier`, etc. The `TEARDOWN_PLAN` entry `{ domain: 'workflows', dataKey: 'workflows', teardownKey: 'workflowsTeardown' }` is appended after the existing six entries.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| The ADR tenancy model is not yet finalized when this change is implemented | Design supports both models with a compile-time flag; D2 and D3 are mutually exclusive branches activated by a configuration constant in `flow-executor.mjs`. Spec requirements are model-agnostic. |
| Temporal visibility query construction is subtle; a bug silently omits the tenant filter | The cross-tenant probe suite (requirement 6) must be written first (red-green discipline) and fails immediately if the filter is absent. |
| Per-execution token minting adds latency to every execution start | Token mint is synchronous but cheap (HMAC + DB insert); measured p99 budget is 5ms. For high-frequency starts, tokens are pre-minted in a small pool per workspace. |
| Workflows teardown during tenant purge may time out on large execution counts | Teardown uses Temporal bulk-terminate API (namespace-per-tenant: namespace delete; shared-namespace: `ListWorkflows` + `TerminateWorkflow` loop with pagination). Partial termination is logged, and the partial-failure path in `tenant-purge-sweep.mjs` handles retries. |

## Migration Plan

1. Apply `NNN-flow-quota-dimensions.sql` migration (idempotent, `ON CONFLICT DO NOTHING`).
2. Deploy `workflows-applier.mjs` and updated `tenant-purge-sweep.mjs` (backward-compatible: existing tenants with no workflows domain data are no-ops in the teardown).
3. Deploy updated flow executor with tenancy enforcement and per-execution token logic.
4. Run cross-tenant probe suite against staging; verify all probes return 404/403.

Rollback: the quota dimension seed and applier addition are additive; removing them is safe at any point before the flow API is publicly enabled.

## Open Questions

- **Q1**: Which tenancy model did the #356 ADR choose? Decision gates D2 vs D3 path selection.
- **Q2**: Should `max_flow_versions` be a per-flow limit or a per-tenant aggregate? The current design treats it as per-flow (consistent with per-function limits in `max_functions`), but the issue text says "per tenant". Confirm with product before implementing the quota collector.
