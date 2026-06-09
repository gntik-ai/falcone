## Context

Falcone's `quota_metering` subsystem already produces per-tenant, per-dimension consumption snapshots on a scheduled cycle. The cycle audit contract (`observability-usage-consumption.json::calculation_audit`) records `cycleId`, `processedScopes`, `degradedDimensions`, and `snapshotTimestamp`. Two orchestrator actions — `tenant-consumption-snapshot-get.mjs` and `workspace-consumption-get.mjs` — expose fully-resolved consumption data including `currentUsage`, `usageStatus`, and per-dimension limits. The business-metrics contract (`observability-business-metrics.json:275`) explicitly defers billing calculations to a downstream consumer. The audit pipeline contract (`observability-audit-pipeline.json:123`) reserves a `billing_boundary_change` optional event category in the `quota_metering` subsystem, but no code has ever emitted it. The platform gateway namespace `/v1/platform/billing/*` exists in routing configuration but no handler is wired. This change adds the missing commercial layer that turns already-computed metering data into billable records.

## Goals / Non-Goals

**Goals:**
- Project per-tenant consumption snapshots into immutable, idempotent usage records keyed by `(cycleId, tenant_id)`.
- Publish usage records to a `console.billing.usage` Kafka topic for downstream consumption by billing providers.
- Expose `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` under platform-admin authorization.
- Emit `billing_boundary_change` audit events on first-time record creation.
- Provide a pluggable adapter interface for routing events to external billing providers (Stripe, custom webhook) without modifying core logic.
- Guarantee idempotency: re-running a cycle does not produce duplicates.

**Non-Goals:**
- Computing new metering data — this change is a pure read-and-project operation on already-computed snapshots.
- Implementing invoice generation, payment processing, or proration logic.
- Changing the `quota_metering` cycle schedule or the consumption snapshot schema.
- Per-workspace billing granularity in the first iteration (tenant-level records only initially).

## Decisions

1. **Idempotency key** — `(cycleId, tenant_id)` is the natural deduplication key because `cycleId` is assigned by the metering cycle and is unique per execution, and `tenant_id` is the billing entity. A unique constraint or upsert on this pair guards the write path.
2. **Kafka topic naming** — `console.billing.usage` follows the existing `console.*` topic namespace pattern used by the platform control plane (observed in `observability-audit-pipeline.json` subsystem IDs).
3. **Billing emitter shape** — the emitter mirrors the `secret-audit-handler` tailer→publisher pattern: subscribe to the metering cycle completion event, resolve snapshots for each tenant in `processedScopes`, write records, publish to Kafka. This keeps the billing path event-driven and decoupled from the metering cycle executor.
4. **Pluggable adapter** — the emitter calls a configurable `billingAdapter.onUsageRecord(record)` hook after Kafka publish. The default adapter is a no-op; operators configure an HTTP webhook or Stripe adapter via environment variables.
5. **Platform-admin authorization** — `/v1/platform/billing/*` routes require `platform_admin` role, consistent with other `/v1/platform/*` routes in the gateway configuration. Tenant-admin actors cannot access these routes.
6. **Audit event** — the `billing_boundary_change` category is an `optional_event_categories` entry in the `quota_metering` subsystem; emitting it here is the first (and intended) use of that reserved slot.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Metering cycle event delivery is at-least-once; duplicates could arrive before the unique constraint is enforced | Use an upsert (`INSERT … ON CONFLICT (cycle_id, tenant_id) DO NOTHING`) so concurrent duplicate arrivals are safe |
| Large `processedScopes` (many tenants per cycle) could cause slow record creation in the same transaction | Process tenants in batches; use a background worker pattern so cycle completion is not blocked |
| A degraded dimension (`degradedDimensions` non-empty) could produce a misleading usage record | Mark records with `hasDegradedDimensions: true` and surface this flag in the query API; downstream billing adapters can hold degraded records for review |
| The `console.billing.usage` topic is new; downstream consumers must be provisioned before enabling the emitter | Document topic creation in the migration plan; the emitter can queue locally if the topic is unavailable |
| Platform-admin route authorization must never leak records across tenants | Enforce `tenant_id` predicate on all repository queries; no unscoped SELECT on the usage records table |

## Migration Plan

1. Create the `billing_usage_records` table with columns `(id, cycle_id, tenant_id, snapshot_at, dimensions JSONB, has_degraded_dimensions BOOL, created_at)` and a unique constraint on `(cycle_id, tenant_id)`.
2. Create the `console.billing.usage` Kafka topic in the platform Kafka namespace.
3. Implement the billing emitter module under `services/billing-export/src/` subscribing to metering cycle completion events.
4. Wire `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` into `services/gateway-config/routes/platform-admin-routes.yaml`.
5. Configure the default no-op billing adapter; document the environment variables for pluggable adapters.
6. Write black-box tests covering idempotency, topic publication, audit event emission, and platform-admin authorization.
7. Run `bash tests/blackbox/run.sh`; confirm all new and existing tests pass.
8. Archive the change.
