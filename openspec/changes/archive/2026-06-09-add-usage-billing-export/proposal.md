## Why

Falcone meters usage through a `quota_metering` calculation cycle — `cycleId`, `processedScopes`, and per-tenant consumption snapshots are already produced and audited — but the metered data is never turned into billable records. The business-metrics contract explicitly states that it "does not define billing calculations, alert thresholds, or UI composition" (`services/internal-contracts/src/observability-business-metrics.json:275`). The audit pipeline reserves a `billing_boundary_change` event category (`services/internal-contracts/src/observability-audit-pipeline.json:123`) but no emitter exists for it. The gateway routes namespace `/v1/platform/billing/*` in the platform-admin surface, yet no handler is wired there. The consumption snapshot actions (`services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs`, `workspace-consumption-get.mjs`) expose fully-resolved per-tenant, per-dimension usage values that are never projected into a billing sink. As a result, the commercial loop from metered consumption to revenue is entirely missing.

## What Changes

- Add a billing emitter module that, after each `quota_metering` calculation cycle, projects per-tenant consumption snapshots into immutable, idempotent usage records keyed by `(cycleId, tenant_id)`.
- Publish usage records to a new `console.billing.usage` Kafka topic with a structured envelope (tenant scope, cycleId, dimensions, timestamp).
- Implement idempotency: re-running a cycle with the same `cycleId` and `tenant_id` does not duplicate records; a deduplication check on `(cycleId, tenant_id)` guards the write path.
- Wire `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` routes in the platform-admin gateway configuration to expose stored usage records with standard pagination.
- Emit a `billing_boundary_change` audit event on each successful usage-record creation, reusing the already-reserved audit category.
- Expose a pluggable billing adapter interface so operators can route `console.billing.usage` events to external billing providers (Stripe, custom webhook) without modifying core code.

## Capabilities

### New Capabilities

- `billing`: Projects per-tenant metered-consumption snapshots into immutable, idempotent usage records published to `console.billing.usage`, queryable via `/v1/platform/billing/*`, and audited with the `billing_boundary_change` category; closes the loop from metered usage to revenue.

### Modified Capabilities

## Impact

- `services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs::main` — consumed as the upstream data source
- `services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs::main` — workspace-level dimension source
- `services/internal-contracts/src/observability-usage-consumption.json::calculation_audit` (lines 245–261) — cycleId/processedScopes/snapshotTimestamp fields reused
- `services/internal-contracts/src/observability-business-metrics.json:275` — billing disclaimer; this change adds the capability the contract explicitly deferred
- `services/internal-contracts/src/observability-audit-pipeline.json:123` — `billing_boundary_change` optional category wired for the first time
- New topic `console.billing.usage` (platform Kafka namespace)
- New routes `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` (`services/gateway-config/routes/platform-admin-routes.yaml`)
- New billing emitter service or module under `services/billing-export/` (mirrors the `secret-audit-handler` tailer→publisher shape)
