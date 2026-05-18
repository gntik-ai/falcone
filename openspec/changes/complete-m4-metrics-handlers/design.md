## Goals

1. Every operationId in `apps/control-plane/openapi/families/metrics.openapi.json`
   (16 total) resolves to a real handler in `services/metrics-api/`.
2. A single recorder library — `services/metrics-runtime/` — owns metric
   registration; producers import it directly rather than passing
   recorders as parameters.
3. Reads come from Prometheus (`query_range`) for time-series data and
   from a Kafka consumer of the audit topics for audit-correlation/export
   operations. The façade `observability-admin.mjs` becomes a thin layer
   over the reader.

## Non-goals

- **Pushing the audit topics through the metrics-api** for events outside
  the M1 audit family. M4 reads what M1/M2 emit; it does not duplicate the
  emit path.
- **Cardinality enforcement** (forbidden-labels list,
  `tenant_id`/`workspace_id` attribution rules). Covered by
  `fix-m4-invariant-enforcement`.
- **Suppression and degraded-state gating.** Covered by
  `harden-m4-degraded-and-suppression`.
- **Idempotency-Key replay-store semantics** for `exportTenantAuditRecords`
  / `exportWorkspaceAuditRecords`. Header parsing exists; the replay-store
  contract is covered by `harden-m4-precision-and-export`.

## Where the handlers live

`services/metrics-api/src/handlers/` — one file per operationId:

- Tenant scope (6): `getTenantAuditCorrelation.mjs`,
  `exportTenantAuditRecords.mjs`, `listTenantAuditRecords.mjs`,
  `getTenantQuotaUsageOverview.mjs`, `getTenantQuotaPosture.mjs`,
  `getTenantUsageSnapshot.mjs`.
- Workspace scope (10): same operations plus
  `getWorkspaceEventDashboards.mjs`,
  `getWorkspaceGatewayStreamMetrics.mjs`,
  `getWorkspaceKafkaTopicMetrics.mjs`,
  `getWorkspaceMetricSeries.mjs`.

Each handler:

1. Resolves `tenantId` (and `workspaceId` where applicable) from
   gateway-injected headers `x-falcone-tenant-id` / `x-falcone-workspace-id`.
2. Rejects requests where the header doesn't match the path parameter
   (defence in depth alongside the gateway's `x-tenant-binding` check).
3. Delegates to a `MetricsReader` method named after the operationId;
   the reader is the only place that talks to Prometheus or Kafka.

## Prometheus/audit-topic read patterns

`MetricsReader` (`services/metrics-runtime/src/reader.mjs`):

- `queryRange(metricName, labels, window)` → wraps Prometheus
  `query_range` against the URL from the `metrics-stack.json` contract's
  `scrape_endpoint`. Used by `getWorkspaceMetricSeries`,
  `getWorkspaceGatewayStreamMetrics`,
  `getWorkspaceKafkaTopicMetrics`, the two quota-overview operations, and
  the two quota-posture operations.
- `streamAuditRecords({tenantId, workspaceId?, filters, cursor})` →
  Kafka consumer reading the audit topic from the cursor (page[after]
  format described in the OpenAPI), filtered server-side by
  `subsystem, actionCategory, outcome, actorType, originSurface,
  correlationId`. Used by the three audit-list/correlation/export
  operations on each scope.
- `aggregateUsageSnapshot({tenantId, workspaceId?})` → composes a
  `queryRange` per metered dimension and assembles the
  `UsageSnapshotResponse`. Used by the two usage-snapshot operations.

## Recorder vs emitter distinction

The audit collapsed "recorder" and "emitter" into one no-op function. We
unbundle:

- **Recorder** (`createPrometheusRecorder`) — owns metric registration
  via `prom-client` (Counter, Gauge, Histogram) and exposes a `/metrics`
  text-exposition handler. Producers call typed methods
  (`recorder.counter('name').inc({...})`, `recorder.histogram('name').observe(value, {...})`).
  Synchronous and in-process.
- **Emitter** (`createKafkaEmitter`) — publishes business-metric events
  to the audit topics (M1/M2 surface) for downstream aggregation. Async,
  buffered, retry-safe. Used by code paths where the metric is *also*
  audit (e.g., `quota.threshold.warning_reached`).

The two are independent. A metric can be recorder-only (pure throughput),
emitter-only (audit-shaped), or both (operational + auditable).

## Out-of-scope notes

This change establishes the surface; it does **not** yet enforce
contract invariants (forbidden labels, threshold ordering, alert-payload
masking, suppression on degraded evidence). Those land in the four
follow-on `fix-m4-*` / `harden-m4-*` proposals. Sequencing:
`complete-m4-metrics-handlers` first → `fix-m4-quota-vocabulary-alignment`,
`fix-m4-schema-required-and-tenant-binding` (schema-only),
`fix-m4-invariant-enforcement` (recorder-side checks),
`harden-m4-*` (operational hardening).
