## 1. Black-box coverage (write first; must be red before implementation)

- [x] 1.1 Write failing black-box test `bbx-billing-cycle-produces-records` in `tests/blackbox/` that simulates a metering cycle completion event and asserts one usage record is created per tenant in `processedScopes`
- [x] 1.2 Write failing test `bbx-billing-idempotency` that replays a cycle event with the same `cycleId` and `tenant_id` and asserts no duplicate record is created
- [x] 1.3 Write failing test `bbx-billing-topic-publish` that verifies a `console.billing.usage` message is published for each new usage record and no duplicate message is published on replay
- [x] 1.4 Write failing test `bbx-billing-audit-event` that asserts a `billing_boundary_change` audit event is emitted on first-time record creation and not emitted on cycle replay
- [x] 1.5 Write failing test `bbx-billing-query-platform-admin` that calls `GET /v1/platform/billing/usage` with a platform-admin token and asserts HTTP 200 with paginated records
- [x] 1.6 Write failing test `bbx-billing-query-unauthorized` that calls `GET /v1/platform/billing/usage` without platform-admin scope and asserts HTTP 403
- [x] 1.7 Write failing test `bbx-billing-query-tenant-scoped` that calls `GET /v1/platform/billing/usage/{tenantId}` and asserts only that tenant's records are returned
- [x] 1.8 Confirm all new tests are red before any implementation is applied
- [x] 1.9 Run `bash tests/blackbox/run.sh` and record the pre-implementation failure output

## 2. Schema and infrastructure

- [x] 2.1 Create migration for `billing_usage_records (id, cycle_id, tenant_id, snapshot_at, dimensions JSONB, has_degraded_dimensions BOOL, created_at)` with a unique constraint on `(cycle_id, tenant_id)` and an index on `tenant_id`
- [x] 2.2 Create the `console.billing.usage` Kafka topic in the platform Kafka namespace with appropriate retention and partition settings
- [x] 2.3 Document required Kafka topic configuration in `services/billing-export/` service manifest

## 3. Billing emitter module

- [x] 3.1 Create `services/billing-export/src/index.mjs` — event-driven subscriber to metering cycle completion events, following the `secret-audit-handler` tailer→publisher shape
- [x] 3.2 Implement `createUsageRecord(db, { cycleId, tenantId, dimensions, snapshotTimestamp })` using `INSERT … ON CONFLICT (cycle_id, tenant_id) DO NOTHING` and returning a flag indicating whether the record was newly created or deduplicated
- [x] 3.3 Implement `publishUsageEvent(kafkaProducer, record)` that publishes to `console.billing.usage` only when `createUsageRecord` returns `created = true`
- [x] 3.4 Implement `emitBillingAuditEvent(auditClient, record)` using `billing_boundary_change` category and `quota_metering` subsystem; call only when `created = true`
- [x] 3.5 Implement the pluggable adapter interface `billingAdapter.onUsageRecord(record)` — default no-op; configurable via environment variable (`BILLING_ADAPTER_URL` / `BILLING_ADAPTER_TYPE`)
- [x] 3.6 Handle `degradedDimensions` from the cycle audit: set `has_degraded_dimensions = true` on the record and include the degraded-dimension keys in the Kafka message payload

## 4. Consumption snapshot integration

- [x] 4.1 Wire the billing emitter to call `tenant-consumption-snapshot-get` action output for each `tenant_id` in `processedScopes` to resolve dimension values before creating usage records
- [x] 4.2 Confirm authorization: the emitter runs as an internal actor, so `resolveTenantId` in `tenant-consumption-snapshot-get.mjs` must accept `actor.type === 'internal'` (already present — verify no change needed)
- [x] 4.3 Batch processing: process tenants in configurable batch sizes to avoid blocking the cycle completion acknowledgment

## 5. Gateway routes

- [x] 5.1 Add `GET /v1/platform/billing/usage` route to `services/gateway-config/routes/platform-admin-routes.yaml` with `planCapabilityAnyOf: []` and `requiredRoles: [platform_admin]`
- [x] 5.2 Add `GET /v1/platform/billing/usage/{tenantId}` route with the same authorization requirements
- [x] 5.3 Wire both routes to the billing-export service handler with pagination support (`limit`, `offset` query parameters)

## 6. Verify

- [x] 6.1 Apply migration and confirm `billing_usage_records` table exists with the correct schema
- [x] 6.2 Run `bash tests/blackbox/run.sh`; confirm `bbx-billing-cycle-produces-records`, `bbx-billing-idempotency`, `bbx-billing-topic-publish`, `bbx-billing-audit-event`, `bbx-billing-query-platform-admin`, `bbx-billing-query-unauthorized`, and `bbx-billing-query-tenant-scoped` all pass (green)
- [x] 6.3 Confirm all existing contract and black-box tests still pass
- [x] 6.4 Verify that replaying a cycle twice produces exactly one usage record and exactly one Kafka message

## 7. Archive

- [x] 7.1 Run `openspec validate add-usage-billing-export --strict`
- [x] 7.2 Run `/opsx:archive add-usage-billing-export`
