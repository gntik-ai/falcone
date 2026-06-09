**Change ID:** `add-usage-billing-export`
**Capability:** `billing` (new)
**Type:** enhancement
**Priority:** P1
**OpenSpec change:** `openspec/changes/add-usage-billing-export/`

---

## Why

Falcone meters usage through a `quota_metering` calculation cycle and produces fully-resolved per-tenant consumption snapshots, but the metered data is never projected into billable records. Three code-level facts confirm the gap:

1. The business-metrics contract explicitly disclaims billing: `services/internal-contracts/src/observability-business-metrics.json:275` — "it does not define billing calculations, alert thresholds, or UI composition."
2. The audit pipeline reserves a `billing_boundary_change` optional event category (`services/internal-contracts/src/observability-audit-pipeline.json:123`) in the `quota_metering` subsystem, but no code has ever emitted it.
3. The consumption snapshot actions (`services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs::main`, `workspace-consumption-get.mjs::main`) expose fully-resolved `currentUsage` / `usageStatus` data per dimension; nothing downstream consumes this output for billing purposes.

The result: the commercial loop from metered consumption to revenue is entirely missing. A monetized multitenant BaaS cannot invoice tenants without this layer.

## What Changes

- Add a billing emitter module that, after each `quota_metering` cycle, projects per-tenant snapshots into immutable usage records keyed by `(cycleId, tenant_id)`.
- Publish records to a new `console.billing.usage` Kafka topic for downstream billing providers.
- Enforce idempotency via `INSERT … ON CONFLICT (cycle_id, tenant_id) DO NOTHING`; replaying a cycle does not duplicate records.
- Wire `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` under platform-admin authorization.
- Emit a `billing_boundary_change` audit event (first use of the reserved category) for each new record; suppress on replay.
- Provide a pluggable billing adapter interface (default no-op; operators configure Stripe or custom webhook via environment variable).

## Spec Delta (EARS)

Full spec: `openspec/changes/add-usage-billing-export/specs/billing/spec.md`

**REQ-1 — Per-cycle usage records projected from consumption snapshots**
The system SHALL, on each `quota_metering` calculation cycle, project per-tenant consumption snapshots into immutable usage records containing `cycleId`, `tenant_id`, dimension values, and `snapshotTimestamp`.

**REQ-2 — Idempotency on (cycleId, tenant_id)**
The system SHALL ensure that re-running or replaying a `quota_metering` cycle for the same `cycleId` and `tenant_id` does not produce duplicate usage records; the operation MUST be idempotent.

**REQ-3 — Publish to console.billing.usage topic**
The system SHALL publish each newly created usage record to the `console.billing.usage` Kafka topic with a tenant-scoped envelope; deduplicated records MUST NOT re-publish.

**REQ-4 — billing_boundary_change audit event per record creation**
The system SHALL emit a `billing_boundary_change` audit event (`subsystem_id = quota_metering`) for each successful usage-record creation; MUST NOT emit on cycle replay.

**REQ-5 — Platform-admin query surface**
The system SHALL expose `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` returning paginated usage records, accessible only to `platform_admin` actors; non-admin callers MUST receive HTTP 403.

## Tasks

Full task list: `openspec/changes/add-usage-billing-export/tasks.md`

- [ ] 1.1 Write failing test `bbx-billing-cycle-produces-records`
- [ ] 1.2 Write failing test `bbx-billing-idempotency`
- [ ] 1.3 Write failing test `bbx-billing-topic-publish`
- [ ] 1.4 Write failing test `bbx-billing-audit-event`
- [ ] 1.5 Write failing test `bbx-billing-query-platform-admin`
- [ ] 1.6 Write failing test `bbx-billing-query-unauthorized`
- [ ] 1.7 Write failing test `bbx-billing-query-tenant-scoped`
- [ ] 2.1 Create `billing_usage_records` migration with unique constraint on `(cycle_id, tenant_id)`
- [ ] 2.2 Create `console.billing.usage` Kafka topic
- [ ] 3.1–3.6 Implement billing emitter (`services/billing-export/src/index.mjs`)
- [ ] 4.1–4.3 Wire consumption snapshot integration + batching
- [ ] 5.1–5.3 Add gateway routes under `/v1/platform/billing/*`
- [ ] 6.1–6.4 Verify all tests pass; confirm no duplicate records on cycle replay
- [ ] 7.1 Run `openspec validate add-usage-billing-export --strict`
- [ ] 7.2 Run `/opsx:archive add-usage-billing-export`

## Acceptance Criteria

Linked to `bbx-billing-*` tests and spec scenarios in `openspec/changes/add-usage-billing-export/specs/billing/spec.md`:

| Criterion | Test / Scenario |
|-----------|----------------|
| One usage record per tenant per cycle | `bbx-billing-cycle-produces-records` / REQ-1 Scenario 1 |
| All consumption dimensions included | REQ-1 Scenario 2 |
| Cycle replay does not create duplicate record | `bbx-billing-idempotency` / REQ-2 Scenario 1 |
| Two distinct cycleIds produce two distinct records | REQ-2 Scenario 2 |
| New record publishes to `console.billing.usage` | `bbx-billing-topic-publish` / REQ-3 Scenario 1 |
| Deduplicated replay does not re-publish | REQ-3 Scenario 2 |
| New record emits `billing_boundary_change` audit event | `bbx-billing-audit-event` / REQ-4 Scenario 1 |
| Replay does not emit audit event | REQ-4 Scenario 2 |
| Platform admin retrieves records via GET route | `bbx-billing-query-platform-admin` / REQ-5 Scenario 1 |
| Non-admin caller receives HTTP 403 | `bbx-billing-query-unauthorized` / REQ-5 Scenario 2 |
| Tenant-scoped query returns only that tenant's records | `bbx-billing-query-tenant-scoped` / REQ-5 Scenario 3 |

## Code Evidence

| Symbol | Note |
|--------|------|
| `services/internal-contracts/src/observability-usage-consumption.json::calculation_audit` (lines 245–261) | `cycleId`, `processedScopes`, `snapshotTimestamp` — the upstream cycle audit fields reused as the billing record key and timestamp |
| `services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs::main` | Produces `dimensions[]` with `currentUsage`/`usageStatus`; direct data source for usage records |
| `services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs::main` | Workspace-level dimension source; `resolveTenantConsumption` + `resolveWorkspaceConsumption` already combined |
| `services/internal-contracts/src/observability-business-metrics.json:275` | Billing disclaimer — explicit evidence of the deferred billing scope this change closes |
| `services/internal-contracts/src/observability-audit-pipeline.json:123` | `billing_boundary_change` reserved as `optional_event_categories` in `quota_metering` subsystem — never yet emitted |

## Resolution (OpenSpec)

1. `/opsx:apply add-usage-billing-export` — work through `tasks.md` (test-first: all `bbx-billing-*` tests must be red before implementation begins)
2. `/opsx:verify add-usage-billing-export`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive add-usage-billing-export`

Shorthand: `/implement-change add-usage-billing-export`

Optional real-stack E2E: `/e2e-issue add-usage-billing-export`
