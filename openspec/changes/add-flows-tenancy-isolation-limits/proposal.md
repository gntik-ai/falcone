## Why

The Temporal-based workflow engine (epic #355) introduces a new multi-tenant execution surface whose cardinal risk — cross-tenant leakage via Temporal visibility queries, task queues, workflow IDs, or noisy-neighbor exhaustion — is not yet addressed by any code or spec. Without a chosen and enforced tenancy model, per-tenant quotas, audit events, and a cascading tenant-deletion path for flows, the `workflows` capability cannot be considered safe for production and will block the monitoring (#367) milestone.

## What Changes

- **Tenancy model enforcement** (aligned with the ADR chosen in #356): every Temporal visibility query and describe/history/signal/cancel call is filtered and verified against the caller's `{ tenantId, workspaceId }` resolved from `apps/control-plane/src/runtime/server.mjs::resolveIdentity` — never client-supplied. If the namespace-per-tenant model is chosen: namespace provisioning/teardown is wired into the `provisioning-orchestrator` tenant lifecycle hooks alongside the existing six-domain `TEARDOWN_PLAN` (`services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs::TEARDOWN_PLAN`). If the shared-namespace model is chosen: `tenantId` + `workspaceId` search attributes are stamped server-side at execution start and every query carries a filter.
- **Workflow ID namespacing**: IDs are generated server-side as `{tenantId}:{workspaceId}:{flowId}:{runUuid}`; clients cannot supply or forge them.
- **Per-execution short-lived credentials**: a tenant-scoped service token is minted at flow start, scoped to `tenantId` + `workspaceId`, and expires with the run; activities validate it before acting; credential expiry is enforced by the existing `credential-rotation-expiry-sweep` pattern.
- **Per-tenant/workspace quota dimensions**: five new entries in `quota_dimension_catalog` (`max_flows`, `max_flow_versions`, `max_concurrent_executions`, `flow_starts_per_minute`, `flow_signal_rate_per_minute`) enforced via the existing `quota-enforce` action (`services/provisioning-orchestrator/src/actions/quota-enforce.mjs::main`); breach returns 429. One tenant saturating its quota MUST NOT delay another tenant's dispatch.
- **Audit events**: flow lifecycle actions (flow create/update/publish/delete, execution start/cancel/retry/signal) are emitted to the existing audit pipeline (`services/audit/src/contract-boundary.mjs`) with `tenantId`, `workspaceId`, `actorId`, `flowId`, `flowVersion`, and `occurredAt` fields.
- **Tenant-deletion cascade**: the `workflows` domain is added to `TEARDOWN_PLAN` in `tenant-purge-sweep.mjs`; on tenant deletion all flow definitions, versions, schedules, and (per model) namespace or Temporal executions are removed with no orphans; teardown is idempotent and retryable.
- **Cross-tenant isolation test plan**: black-box two-tenant fixtures (matching the pattern in `tests/blackbox/audit-anomaly-alerting.test.mjs::TENANT_A/TENANT_B`) covering every flows route + execution observation path; every probe MUST return 404/403 with zero data leakage; search-attribute filter injection and forged workflow IDs always return 404/403.

## Capabilities

### New Capabilities

- `workflows`: Tenancy model enforcement, per-execution credential lifecycle, per-tenant/workspace quota dimensions and enforcement, audit event emission for all flow lifecycle actions, tenant-deletion cascade for the workflows domain, and the enumerated cross-tenant isolation test plan.

### Modified Capabilities

- `tenant-isolation`: New ADDED requirements for workflows-domain cross-tenant probe guarantees (visibility query filter injection, forged workflow ID interception, task-queue isolation) that extend the existing RLS-grounded isolation spec.

## Impact

- `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs` — new `workflows` entry in `TEARDOWN_PLAN`.
- `services/provisioning-orchestrator/src/migrations/` — new migration seeding five quota dimension keys.
- `services/provisioning-orchestrator/src/actions/quota-enforce.mjs` — called at flow API boundary with new dimension keys.
- `apps/control-plane/src/runtime/` — flow executor enforces search-attribute filter / namespace check before every Temporal API call.
- `services/audit/src/` — new `flow_lifecycle_event` contract entry.
- `tests/blackbox/` — new two-tenant probe suite covering all flows routes and execution paths.
- No changes to the public APISIX gateway routes (sibling change `add-flows-control-plane-api` owns the route catalog).
