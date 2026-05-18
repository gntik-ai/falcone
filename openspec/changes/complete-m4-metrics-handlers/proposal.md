## Why

M4 declares 16 metrics operations in
`apps/control-plane/openapi/families/metrics.openapi.json` (4619 LOC) but
no production handler serves any of them, and the only runtime emitter in
the repo declares metric *names* — not samples. From
`openspec/audit/cap-m4-observability-metrics.md`:

- **B6** (verified by grep on `metrics.openapi.json` + source) — the 16
  declared operationIds (`getTenantAuditCorrelation`,
  `exportTenantAuditRecords`, `listTenantAuditRecords`,
  `getTenantQuotaUsageOverview`, `getTenantQuotaPosture`,
  `getTenantUsageSnapshot`, plus 10 workspace-scoped operations) have no
  `main(params)` action file or HTTP handler in source. The 4619-LOC
  OpenAPI is documentation in search of producers.
- **B7** (`services/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs:32-34`)
  — `recordMetric(recorder, name, value, tags)` calls `recorder(...)` only
  if `recorder` is a function. The module declares 6 metric names but
  ships no recorder; `prom-client` (or any equivalent) is not a declared
  dependency anywhere in the repo.
- **G-S1.1** — all 16 routes are declared without handlers (cross-checked
  against the capability map's TODO: "Concrete handlers for the metrics
  family were not located.").
- **G-S13.1/G-S13.2** — only six metric names declared (all
  `plan_change_history_*`); none of the 16 routes has a corresponding
  runtime emitter.
- **G-S14.1** — `apps/control-plane/src/observability-admin.mjs` is a
  2470-LOC façade that re-exports getters; it registers no HTTP routes
  and emits no samples.

## What Changes

- Stand up a `services/metrics-api/` runtime that registers all 16
  handlers, sourcing from a new `MetricsReader` interface backed by
  Prometheus (read-side scrape against the `apisix-prometheus` aggregator)
  and a Kafka consumer for the audit topics consumed by the export and
  correlation operations.
- Establish the **recorder vs emitter** distinction in source: a
  `services/metrics-runtime/` package providing a real
  `PrometheusRecorder` (wrapping `prom-client`) plus a `KafkaEmitter` for
  business metrics that flow through audit topics. Every existing
  declared metric name (the 6 in `plan-change-impact-metrics.mjs` plus
  new ones for the 16 routes) is registered through this recorder.
- Wire the metrics façade `observability-admin.mjs` to delegate its
  computed summaries to the new reader rather than to local contract
  projections — closing the loop between contracts and runtime.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on a metrics runtime that serves
  all 16 declared operations, on the recorder/emitter distinction, and on
  Prometheus + audit-topic reads as the source of truth.

## Impact

- **Affected code**: new `services/metrics-api/`; new
  `services/metrics-runtime/` (package); edit of
  `services/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs`
  to import `PrometheusRecorder` instead of accepting an injected recorder;
  edit of `apps/control-plane/src/observability-admin.mjs` to delegate to
  the reader; new `services/gateway-config/routes/metrics.yaml` wiring all
  16 routes to the new service.
- **Migration required**: `prom-client` and `kafkajs` (latter likely
  present) added to `services/metrics-runtime/package.json`; a Prometheus
  scrape target for the new service added to the cluster manifest under
  `helm/`.
- **Breaking changes**: callers of `recordMetric(recorder, ...)` that
  passed a no-op `recorder` to silence the call must be updated;
  `observability-admin.mjs` getters that previously fell back to contract
  defaults now return data the reader provides.
- **Cross-cutting**: this change is the prerequisite for
  `fix-m4-invariant-enforcement` (the runtime invariants need a recorder
  to be enforced) and `harden-m4-degraded-and-suppression` (suppression
  needs an emitter to gate).
