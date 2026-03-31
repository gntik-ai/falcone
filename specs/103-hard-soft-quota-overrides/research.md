# Research: Hard & Soft Quotas with Superadmin Override

**Feature**: 103-hard-soft-quota-overrides | **Date**: 2026-03-31

## R-01 — Hard/Soft Quota Type Storage Strategy

**Decision**: Add a new JSONB column `plans.quota_type_config` as a parallel metadata map to the existing `plans.quota_dimensions` numeric map.

**Rationale**: Keeping type/grace metadata separate from numeric limits avoids breaking the T01/T02 contract for `quota_dimensions` (which is `string → number`). If a dimension key is absent from `quota_type_config`, it defaults to `{ "type": "hard" }` per FR-005.

**Alternatives considered**:
- Changing `quota_dimensions` values from numbers to objects `{ value, type, graceMargin }` — rejected: breaks T01 contract, requires full data migration.
- Normalized `plan_quota_types` junction table — rejected: dual-write complexity for small bounded data.
- Storing type info in `quota_dimension_catalog` — rejected: type classification varies per plan, not per dimension globally.

## R-02 — Quota Override Storage Model

**Decision**: Create a dedicated `quota_overrides` table with lifecycle status tracking and a partial unique index enforcing single-active-override-per-tenant-per-dimension.

**Rationale**: Overrides have an independent lifecycle from plans and tenant assignments. They survive plan changes. A dedicated table with proper indexing provides clean CRUD semantics and database-level invariant enforcement.

**Alternatives considered**:
- JSONB on `tenant_plan_assignments` — rejected: overrides survive plan changes, need independent lifecycle.
- Extension of `plan_audit_events` — rejected: overrides are tenant-level, not plan-level.

## R-03 — Effective Limit Resolution Strategy

**Decision**: Compute at query time with a single SQL join across `quota_dimension_catalog`, `plans`, `tenant_plan_assignments`, and `quota_overrides`. Resolution: override > plan > catalog default.

**Rationale**: No materialized view needed at expected scale (≤50 dimensions × ≤200 tenants). Sub-20ms for single tenant profile.

**Alternatives considered**:
- Materialized view — rejected: premature optimization, adds maintenance.
- Redis cache layer — rejected: premature for expected scale.

## R-04 — Enforcement Decision Flow

**Decision**: Internal OpenWhisk action `quota-enforce.mjs` invoked synchronously by resource-creation actions. Returns structured decision with allow/block/warn semantics.

**Rationale**: Centralizes enforcement logic; all resource-creation paths call the same action. Fail-closed when metering unavailable.

**Alternatives considered**:
- Inline enforcement in each resource-creation action — rejected: code duplication.
- APISIX plugin enforcement — deferred to T05.

## R-05 — Override Concurrency Control

**Decision**: Partial unique index `(tenant_id, dimension_key) WHERE status = 'active'` combined with transactional supersede-then-insert.

**Rationale**: Database-level invariant enforcement is stronger than application-level checks across distributed OpenWhisk action instances.

**Alternatives considered**:
- Optimistic locking with version column — unnecessary given partial unique index.
- Application-level mutex — fragile across OpenWhisk instances.

## R-06 — Override Expiry Sweep

**Decision**: Scheduled OpenWhisk action runs every 5 minutes (configurable), batch-transitions expired overrides. Query-time filter provides real-time correctness independently.

**Rationale**: Dual approach — query-time filter for correctness, sweep for data cleanliness. Follows established scheduling-engine pattern.

**Alternatives considered**:
- Query-time only — rejected: leaves stale active status.
- pg_cron — rejected: OpenWhisk scheduling is the established pattern.

## R-07 — Audit Event Strategy

**Decision**: Override lifecycle events → `plan_audit_events` table + Kafka topics. Enforcement decisions → Kafka topics only (no PostgreSQL persistence for high-volume enforcement events).

**Rationale**: Override events are low-volume and need queryable audit. Enforcement events are high-volume and better served as event streams.

**Alternatives considered**:
- Separate `quota_audit_events` table — rejected: duplicates existing audit pattern.
- Persisting enforcement events to PostgreSQL — rejected: write amplification disproportionate.

## R-08 — No New Infrastructure

**Decision**: Six new Kafka topics (30d retention), one new PostgreSQL table, one new JSONB column. No new Helm charts or services.

**Rationale**: Incremental delivery (Constitution Principle II).
