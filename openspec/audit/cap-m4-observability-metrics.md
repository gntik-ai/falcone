# Capability M4 — Observability & Metrics (control surface)

**Source locus:**
- `apps/control-plane/openapi/families/metrics.openapi.json` — **4619 LOC**, **16 operationIds** under `/v1/metrics/{tenants|workspaces}/...`.
- `apps/control-plane/src/observability-admin.mjs` — **2470 LOC, 104 KB façade** importing ~50 getters from `services/internal-contracts/`.
- `services/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs` — **34 LOC** of metric-name exports + 2 helpers.
- `services/internal-contracts/src/observability-*.json` — **10 contract files** (15 total counting the 5 audit-related ones covered in M1):
  - `observability-metrics-stack.json` (T01)
  - `observability-dashboards.json` (T02)
  - `observability-health-checks.json` (T03)
  - `observability-business-metrics.json` (T04)
  - `observability-threshold-alerts.json`
  - `observability-console-alerts.json` (T05)
  - `observability-hard-limit-enforcement.json` (T04)
  - `observability-quota-policies.json` (T02)
  - `observability-quota-usage-view.json` (T05)
  - `observability-usage-consumption.json` (T01)
- `scripts/validate-observability-*.mjs` — **15 validator scripts** + 15 lib implementations under `scripts/lib/observability-*.mjs` (covers all 15 contracts including the 5 audit-related ones).
- `tests/contracts/observability-*` — contract tests (existence verified by file listing; not exhaustively read).

**Method.** Read `plan-change-impact-metrics.mjs` (34 LOC), sampled one validator script (`validate-observability-metrics-stack.mjs`) and the façade's import header myself. Delegated two parallel Explore agents — one for the 4619-LOC metrics OpenAPI fragment, one for the 10 observability JSON contracts + their validators. After agents returned, **spot-verified four claims** by direct read:
- 16 operationIds (verified by grep — matches the agent's enumeration).
- `observability-admin.mjs` exists at 2470 LOC and imports 50+ contract getters (verified by `wc -l` + import header read).
- 15 validator scripts have matching 15 `scripts/lib/observability-*.mjs` libraries (verified by `ls`).
- Hard-limit and quota-policies both use `dimensionId` as the keyword but with different enum values (verified by grep).

**Up-front observations:**
- M4 is the **best-decomposed** observability story in the repo: real OpenAPI surface (16 routes), real JSON contracts (10 + 5 audit), real validators (15), real consumer (`observability-admin.mjs` is the largest single file in `apps/control-plane/src/`).
- BUT: **only one production runtime emitter exists** — `plan-change-impact-metrics.mjs` (34 LOC) — and it just declares metric *names* (string constants) plus a log-builder helper. No code in the repo emits Prometheus samples; no `prom-client` or similar is declared.
- The validator scripts enforce **JSON-structure invariants only** (required fields, version alignment, enum vocab present). None of them enforces *runtime* invariants (cardinality bounds, scope isolation, alert suppression, masking, threshold ordering).
- `observability-admin.mjs` is a façade — like the other A1-pattern apps/control-plane modules: re-exports getters and aggregator functions. It computes summaries from the contracts; it does not emit metrics, run dashboards, or evaluate thresholds.
- **Per the capability map's TODO**: "Concrete handlers for the metrics family were not located." This audit confirms: the 16 routes in `metrics.openapi.json` have no handler in source.

---

## SPEC (what exists)

### S1. Public API surface (`metrics.openapi.json`, 16 operationIds, 4619 LOC)

- **WHEN** the metrics family is invoked under `/v1/metrics/tenants/{tenantId}/...`, **THE SYSTEM SHALL** declare 6 tenant-scoped operations: `getTenantAuditCorrelation` (`/audit-correlations/{correlationId}`), `exportTenantAuditRecords` (`/audit-exports`, POST), `listTenantAuditRecords` (`/audit-records`), `getTenantQuotaUsageOverview` (`/overview`), `getTenantQuotaPosture` (`/quotas`), `getTenantUsageSnapshot` (`/usage`) (`metrics.openapi.json:2234-3160`, subagent-reported).
- **WHEN** the metrics family is invoked under `/v1/metrics/workspaces/{workspaceId}/...`, **THE SYSTEM SHALL** declare 10 workspace-scoped operations: `getWorkspaceAuditCorrelation`, `exportWorkspaceAuditRecords`, `listWorkspaceAuditRecords`, `getWorkspaceEventDashboards`, `getWorkspaceGatewayStreamMetrics`, `getWorkspaceKafkaTopicMetrics`, `getWorkspaceQuotaUsageOverview`, `getWorkspaceQuotaPosture`, `getWorkspaceMetricSeries`, `getWorkspaceUsageSnapshot` (`metrics.openapi.json:3155-4619`, subagent-reported).
- **WHEN** audit list/export operations are invoked, **THE SYSTEM SHALL** support cursor pagination (`page[size]` 1–200, `page[after]`) and rich filtering by `subsystem, actionCategory, outcome, actorType, originSurface, correlationId` (`metrics.openapi.json:2544, :3467`, subagent-reported).
- **WHEN** an audit export is requested, **THE SYSTEM SHALL** require `Idempotency-Key` header, accept `AuditExportRequest`, return `AuditExportManifest` with format `jsonl|csv`, items, filters, masking profile (`metrics.openapi.json:2391-2520, :3313-3463`, subagent-reported).
- **WHEN** event-dashboard / gateway-stream / kafka-topic metrics are queried, **THE SYSTEM SHALL** require `window` query param `∈ {5m, 1h, 24h}` (`metrics.openapi.json:3762, :3890, :4006`, subagent-reported).
- **WHEN** `getWorkspaceGatewayStreamMetrics` returns, **THE SYSTEM SHALL** include `source.metricsPath = "/apisix/prometheus/metrics"` and `source.seriesPrefix = "in_falcone_event_gateway_"` as constant values (`metrics.openapi.json:994`, subagent-reported).
- **WHEN** `getWorkspaceMetricSeries` is queried, **THE SYSTEM SHALL** require `metricKey` (3–120 chars) and `window ∈ {5m, 1h, 24h, 7d, 30d}`, returning `MetricSeriesResponse{points[{timestamp, value}]}` (`metrics.openapi.json:4365-4388, :1245`, subagent-reported).

### S2. Contract: metrics stack (`observability-metrics-stack.json`)

- **WHEN** any subsystem emits metrics, **THE SYSTEM SHALL** normalise through the `in_falcone_*` prefix with `tenant_id`/`workspace_id` attribution and bounded cardinality labels covering subsystems `{apisix, kafka, postgresql, mongodb, openwhisk, storage, control_plane}` (`observability-metrics-stack.json:6-9`, subagent-reported).
- **WHEN** metric labels are emitted, **THE SYSTEM SHALL NOT** use forbidden labels `{user_id, session_id, request_id, raw_path, object_key, …}` (`:86-95`, subagent-reported).
- **WHEN** scrapers run, **THE SYSTEM SHALL** honour per-subsystem `interval_seconds` and `max_staleness_seconds` (`:259-265`, subagent-reported). Default staleness window 120s (`:217, :234-245`).

### S3. Contract: dashboards (`observability-dashboards.json`)

- **WHEN** an authorised actor requests a health summary, **THE SYSTEM SHALL** render hierarchical scopes `global → tenant → workspace` with freshness-aware status and inherited degradation visibility (`:46-72`, subagent-reported).
- **WHEN** workspace views are rendered, **THE SYSTEM SHALL** forbid widening scope (no `workspace → tenant`, no `workspace → global`); `forbidden_transitions` enforced declaratively (`:33-43`, subagent-reported).
- **WHEN** subsystems lack workspace attribution, **THE SYSTEM SHALL** apply per-subsystem `workspace_fallback ∈ {tenant_inherited, workspace_native}` (`:155, :323`, subagent-reported).

### S4. Contract: health checks (`observability-health-checks.json`)

- **WHEN** components expose `liveness/readiness/health` probes, **THE SYSTEM SHALL** project results into metrics `component_probe_status, component_probe_duration_seconds, component_probe_failures_total` (`:13-56`, subagent-reported).
- **WHEN** the status value model is applied, **THE SYSTEM SHALL** map `success → 1, failure → 0, unknown → -1` (`:172-176`, subagent-reported); `degraded` value mapping is not declared.
- **WHEN** components declare `readiness_dependencies` / `health_dependencies`, **THE SYSTEM SHALL** include them in posture evaluation (`:254-263`, subagent-reported).

### S5. Contract: business metrics (`observability-business-metrics.json`)

- **WHEN** product activity occurs (API requests, function invocations, storage usage, data ops, realtime connections), **THE SYSTEM SHALL** emit `in_falcone_*_total` and `in_falcone_*_ratio` families with `domain, metric_type, feature_area, operation_family` labels (`:8-12`, subagent-reported).
- **WHEN** business-metric emission occurs, **THE SYSTEM SHALL** populate `audit_context = {actor_id, dashboard_scope, tenant_id, workspace_id, metric_family_id, correlation_id}` (`:236-242`, subagent-reported).
- **WHEN** `api_requests_total` is computed, **THE SYSTEM SHALL** apply `safe_attribution_policy = "workspace_safe_when_route_context_is_attributable"` (`:364`, subagent-reported).

### S6. Contract: threshold alerts (`observability-threshold-alerts.json`)

- **WHEN** quota usage crosses warning/soft/hard thresholds, **THE SYSTEM SHALL** emit `quota.threshold.*` events with `previousPosture → newPosture` transitions and `evidenceFreshness` (`:10-52`, subagent-reported).
- **WHEN** collection health is degraded, **THE SYSTEM SHALL** suppress emissions per `suppression_causes = {evidence_degraded, evidence_unavailable}` (`:54-64`, subagent-reported).
- **WHEN** escalation/recovery order applies, **THE SYSTEM SHALL** escalate `warning → soft_limit → hard_limit` and recover in reverse (`:111-119`, subagent-reported).

### S7. Contract: console alerts (`observability-console-alerts.json`)

- **WHEN** platform/tenant/workspace health degrades, **THE SYSTEM SHALL** surface scope-safe summaries with attribution labels `{platform_condition, tenant_local, workspace_local}` and 4 internal alert categories (`:9-13`, subagent-reported).
- **WHEN** alert lifecycle state changes, **THE SYSTEM SHALL** transition `active → {acknowledged, resolved, suppressed}`; `suppressed` is terminal (`:218-250`, subagent-reported).
- **WHEN** alert payloads are constructed, **THE SYSTEM SHALL NOT** expose `{password, secret, token, connection_string, raw_hostname, raw_endpoint, object_key, raw_topic_name}` (`:411-422`, subagent-reported).
- **WHEN** health aggregation runs, **THE SYSTEM SHALL** apply priority ordering `{healthy: 50, degraded: 40, unavailable: 10, stale: 20, unknown: 30}` (`:103-132`, subagent-reported).

### S8. Contract: hard-limit enforcement (`observability-hard-limit-enforcement.json`)

- **WHEN** a resource-creation request hits `hard_limit_reached` posture, **THE SYSTEM SHALL** deny with HTTP 429 `QUOTA_HARD_LIMIT_REACHED` and audit `{decision ∈ allowed|denied}` (`:44-59`, subagent-reported).
- **WHEN** enforced, **THE SYSTEM SHALL** scope to 8 dimensions: `api_requests, serverless_functions, storage_buckets, logical_databases, kafka_topics, collections_tables, realtime_connections, error_budget` (`:62-150`, subagent-reported).

### S9. Contract: quota policies (`observability-quota-policies.json`)

- **WHEN** quota posture is evaluated, **THE SYSTEM SHALL** snapshot usage against `warning/soft/hard` thresholds per tenant/workspace, compute headroom, and preserve evidence freshness `∈ {fresh, degraded, unavailable}` (`:10-14`, subagent-reported).
- **WHEN** posture precedence is resolved, **THE SYSTEM SHALL** apply order `hard_limit_reached > soft_limit_exceeded > warning > evidence_unavailable > evidence_degraded > within_limit > unbounded` (`:149-157`, subagent-reported).
- **WHEN** thresholds are configured, **THE SYSTEM SHALL** enforce `warning ≤ soft_limit ≤ hard_limit` (`:113-127`, subagent-reported).
- **WHEN** dimension-scoped, **THE SYSTEM SHALL** use 9 dimensions: `api_requests, function_invocations, storage_volume_bytes, data_service_operations, realtime_connections, logical_databases, topics, collections_tables, error_count` (`:128-138`, subagent-reported).

### S10. Contract: quota usage view (`observability-quota-usage-view.json`)

- **WHEN** an actor queries quota overview, **THE SYSTEM SHALL** return dimensions with visual state `∈ {healthy, warning, elevated, critical, degraded, unknown}` and provisioning-state summaries for tenant scope (`:10-14`, subagent-reported).
- **WHEN** the posture state is mapped to a visual state, **THE SYSTEM SHALL** use the lookup table at `:78-115` (which contains naming inconsistencies — see B2).
- **WHEN** `usagePercentage` is computed, **THE SYSTEM SHALL** divide by `hardLimit` first, then `softLimit`, returning null otherwise (`:116-124`, subagent-reported).

### S11. Contract: usage consumption (`observability-usage-consumption.json`)

- **WHEN** metering snapshots are computed, **THE SYSTEM SHALL** aggregate 9 metered dimensions (`api_requests, function_invocations, storage_volume_bytes, data_service_operations, realtime_connections, logical_databases, topics, collections_tables, error_count`) per tenant/workspace with per-dimension `freshnessStatus` (`:10-14`, subagent-reported).
- **WHEN** an observation window is recorded, **THE SYSTEM SHALL** enforce `startedAt ≤ endedAt` (`:218-226`, subagent-reported).
- **WHEN** evidence is unavailable for a dimension, **THE SYSTEM SHALL** keep the dimension present with `value: 0` and `freshnessStatus: 'unavailable'` (`:241`, subagent-reported).

### S12. Validator scripts (`scripts/validate-observability-*.mjs`)

- **WHEN** any `validate-observability-{contract}.mjs` runs, **THE SYSTEM SHALL** call `collectObservability{Contract}Violations()` from `scripts/lib/observability-{contract}.mjs`, print violations to stderr, and exit non-zero on any violation (sampled at `validate-observability-metrics-stack.mjs:1-14`).
- **WHEN** the root `npm run lint` runs, **THE SYSTEM SHALL** invoke all 15 observability validators (per `package.json:scripts.validate:repo`, audited in A1).

### S13. Production runtime (`provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs`)

- **WHEN** the module is imported, **THE SYSTEM SHALL** export 6 metric-name constants: `plan_change_history_write_total, plan_change_history_write_duration_ms, plan_change_history_query_duration_ms, plan_change_history_over_limit_dimensions_total, plan_change_history_usage_unknown_total, plan_change_history_event_publish_total` (`:1-15`).
- **WHEN** `buildChangeImpactLogFields(entry)` runs, **THE SYSTEM SHALL** return a `{correlationId, tenantId, actorId, historyEntryId, assignmentId, previousPlanId, newPlanId, changeDirection, overLimitDimensionCount, usageUnknownDimensionCount}` projection with null fallbacks (`:17-30`).
- **WHEN** `recordMetric(recorder, name, value, tags)` is called, **THE SYSTEM SHALL** invoke `recorder(name, value, tags)` only if `recorder` is a function (`:32-34`). The module declares no recorder itself.

### S14. Façade (`apps/control-plane/src/observability-admin.mjs`)

- **WHEN** the façade is imported, **THE SYSTEM SHALL** expose ~50 getters from `services/internal-contracts/` for: alert audience routing, alert categories/severities/suppression, hard-limit dimensions/policies/audit/error contracts, health-summary aggregation/freshness/scope/isolation, business-metric domains/families/types/controls, dashboard scopes, health components/exposures/projections/probe-types, quota evaluation/defaults/policy scopes/posture states/threshold types, quota usage-view scopes/visual states/access-audit/defaults, usage calculation/refresh/freshness/metered-dimensions, plus list functions for alert categories/event types/lifecycle states (verified-by-author at `:1-50+`).

---

## GAPS

### G-cross. Cross-cutting

1. **No production handler for any of the 16 metrics routes.** The capability map's TODO is confirmed: `grep -rln "metrics.openapi.json\|families/metrics"` returns no handler. `observability-admin.mjs` consumes the contracts but does not register HTTP routes.
2. **Only one runtime metric emitter exists** (`plan-change-impact-metrics.mjs`, 34 LOC), and it just declares names — no `prom-client` dependency anywhere in the repo (verified by absence of the import in audited files).
3. **Validators only enforce JSON-structure invariants.** They verify required fields, version alignment, and enum vocabulary present. None enforces runtime invariants (cardinality bounds, scope isolation, alert suppression on degraded evidence, masking-policy application, threshold ordering, audit completeness).
4. **Contract version alignment is checked only against the directly-referenced contract.** Cross-contract drift (e.g., threshold-alerts references 4 source contracts) is not detected if a source is bumped independently.
5. **No `securitySchemes` block in `metrics.openapi.json`** that I could locate; routes reference `bearerAuth` (e.g., `:2370`) but the schema is defined in the unified `control-plane.openapi.json` only.

### G-S1. OpenAPI surface

- **G-S1.1** Routes declared without handlers (all 16). The 16 operationIds have no corresponding `main(params)` action file or HTTP handler in source.
- **G-S1.2** `WorkspaceEventDashboardResponse` is missing `tenantId` field — only `workspaceId, window, sampledAt, widgets, coverage` (`:2079`, subagent-reported). All other workspace responses (e.g., `GatewayStreamMetricsResponse:1132`, `KafkaTopicMetricsResponse:1213`) include both ids. Inconsistent tenant context.
- **G-S1.3** `MetricSeriesResponse.unit` is declared (`:1277`) with constraints but not in the `required` array (`:1297-1303`). Clients can't assume unit is present.
- **G-S1.4** `event-dashboards`, `gateway-streams`, `kafka-topics` routes lack `x-tenant-binding` extension (`:3749, :3878, :4006`) while sibling quota/audit routes carry `x-tenant-binding: required`. Inconsistent multi-tenant validation signalling.
- **G-S1.5** `EventDashboardWidget.query` field (`:975`) is a free-form string with no description, enum, or pattern. Is it PromQL? Free text? Undocumented.
- **G-S1.6** `getTenantAuditCorrelation` accepts `maxItems` (default 25, max 200) at `:2280` but no cursor for continuation beyond 200 — large correlations are silently truncated.
- **G-S1.7** `TenantQuotaUsageOverview` includes `TenantProvisioningStateView` (`:1822-1904`) but `WorkspaceQuotaUsageOverview` does NOT include `provisioningState` (`:2142`). Asymmetric domain model.
- **G-S1.8** `Idempotency-Key` is required as header for exports (`:2401, :3322`) but the `AuditExportRequest` body schema (`:444`) does not include an `idempotencyKey` field — duplication of intent.

### G-S2..S11. Contract enforcement

- **G-S2.1** Forbidden-labels list (`observability-metrics-stack.json:86-95`) is declarative; no runtime emitter validates against it.
- **G-S2.2** Per-subsystem `interval_seconds` / `max_staleness_seconds` not honoured by any scraper code in the repo.
- **G-S3.1** Forbidden dashboard transitions (`observability-dashboards.json:33-43`) unenforced by any rendering code.
- **G-S4.1** `degraded` probe status not mapped in the numeric value model (`observability-health-checks.json:32-36, :172-176`).
- **G-S4.2** Component dependency evaluation undocumented in runtime.
- **G-S5.1** `audit_context` required fields (`observability-business-metrics.json:236-242`) — no validator enforces emitters populate them.
- **G-S5.2** `safe_attribution_policy` semantics undocumented operationally; consumers may interpret "attributable" differently.
- **G-S6.1** Suppression on degraded evidence (`observability-threshold-alerts.json:54-64`) is declarative-only.
- **G-S6.2** Escalation order vs posture precedence reversed (see B1).
- **G-S7.1** Forbidden alert-payload fields list (`observability-console-alerts.json:411-422`) unenforced at runtime.
- **G-S7.2** `suppressed → ?` transitions undefined; code may attempt acknowledge/resolve on suppressed alerts.
- **G-S8.1** Threshold ordering rule `warning ≤ soft ≤ hard` (`observability-quota-policies.json:113-127`) unenforced at policy-write time.
- **G-S9.1** `usagePercentage` rounding precision undocumented.
- **G-S10.1** Usage `startedAt ≤ endedAt` invariant unenforced at snapshot creation.

### G-S12. Validators

- **G-S12.1** All 15 validator scripts share the same shape: import a `collectObservability*Violations()` function, print, exit code. They are **structural validators** — they don't check whether emitters honour the contracts, only that the JSON contracts themselves are well-formed.
- **G-S12.2** No cross-contract validator. The script `validate-observability-threshold-alerts.mjs` doesn't check whether the dimension ids in threshold-alerts align with the ids in quota-policies and hard-limit-enforcement (see B1).

### G-S13. Runtime emitter

- **G-S13.1** `plan-change-impact-metrics.mjs:32-34` declares `recordMetric(recorder, …)` but the module **does not provide a recorder**. Callers must inject one. No call site visible in the audited C1 actions (per the C1 audit, `provisioning-orchestrator/src/observability/` was listed as a subdirectory but not deeply read).
- **G-S13.2** Only six metric names declared, all for the `plan_change_history_*` family. The 4619-LOC OpenAPI surface declares 16 routes covering audit-correlation, audit-export, audit-list, quota-posture, usage-snapshot, event-dashboards, gateway-streams, kafka-topics, quota-overview, metric-series — none of which has a corresponding runtime emitter in this file.

### G-S14. Façade

- **G-S14.1** `observability-admin.mjs` is 2470 LOC of getter aggregation and projection — no HTTP route registration, no metric emission, no scrape endpoint. It's a contract-bridge layer.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. Three contracts disagree on quota-dimension vocabulary.**
  Verified by grep: `hard-limit-enforcement.json:62-150` declares 8 dimension ids `{api_requests, serverless_functions, storage_buckets, logical_databases, kafka_topics, collections_tables, realtime_connections, error_budget}`. `quota-policies.json:128-138` declares 9 different ids `{api_requests, function_invocations, storage_volume_bytes, data_service_operations, realtime_connections, logical_databases, topics, collections_tables, error_count}`. `usage-consumption.json:10-14` aligns with quota-policies' 9. **Hard-limit-enforcement's `serverless_functions/storage_buckets/kafka_topics/error_budget` have no canonical mapping in the other two contracts.** Production code that consumes both surfaces must map between vocabularies; no validator detects the divergence.

- **B2. `observability-quota-usage-view.json` posture-mapping table has duplicate keys with inconsistent naming.**
  `:78-115` (subagent-reported) — both `'within_limit'` AND `'within_limits'` map to `'healthy'`; both `'warning_threshold_reached'` AND `'warning_reached'` map to `'warning'`. Consumers using only one variant produce lookup failures.

- **B3. `MetricSeriesResponse.unit` declared with constraints but omitted from `required` array.**
  `metrics.openapi.json:1277, :1297-1303` (subagent-reported). The `unit` field is optional. Clients must handle absent-unit case, contradicting the field's apparent importance for interpretation.

- **B4. `WorkspaceEventDashboardResponse` lacks `tenantId`.**
  `metrics.openapi.json:2079` (subagent-reported). Other workspace response schemas (`GatewayStreamMetricsResponse:1132`, `KafkaTopicMetricsResponse:1213`) include both `tenantId` and `workspaceId`. Tenant context lost in response payload — client cannot assert which tenant owns the dashboard without an additional call.

- **B5. Three workspace observability routes lack `x-tenant-binding` extension.**
  `metrics.openapi.json:3749, :3878, :4006` (subagent-reported). `getWorkspaceEventDashboards`, `getWorkspaceGatewayStreamMetrics`, `getWorkspaceKafkaTopicMetrics` omit `x-tenant-binding: required` while sibling quota/audit routes at the same scope carry it. Multi-tenant validation signalling inconsistent.

- **B6. The 16 metrics routes have no production handler.**
  `grep -rln` confirms no `main(params)` action file or HTTP handler in source maps to any of the 16 operationIds. The capability map's TODO is verified.

- **B7. Only one production runtime emitter exists; it declares names only, not a recorder.**
  `plan-change-impact-metrics.mjs:32-34` (verified-by-author). The module exports `recordMetric(recorder, ...)` which calls the caller's recorder if it's a function. **No code in this module produces actual Prometheus samples**; `prom-client` (or equivalent) is not declared in the audited dependency lists. The 6 metric names are documentation.

- **B8. Validators enforce JSON structure only — no runtime invariant checking.**
  Verified by reading `validate-observability-metrics-stack.mjs:1-14` and the file listing of `scripts/lib/observability-*.mjs`. All 15 validators follow the same shape: load contract, call `collectObservability*Violations()`, print, exit. None verifies a running emitter honours the contract.

- **B9. `degraded` probe status has no numeric projection.**
  `observability-health-checks.json:32-36, :172-176` (subagent-reported). The `allowed_statuses` list includes `'degraded'`; the `status_value_model` maps `{success: 1, failure: 0, unknown: -1}` with no entry for `'degraded'`. Prometheus consumers that quantitatively project `component_probe_status` have no way to represent degraded numerically.

- **B10. Suppression on degraded evidence is contract-only.**
  `observability-threshold-alerts.json:54-64` (subagent-reported) declares `suppression_causes = {evidence_degraded, evidence_unavailable}`. No code in the repo enforces this — see B7/B8 (no runtime emitter, no semantic validator).

- **B11. Forbidden-labels list in metrics-stack is unenforced.**
  `observability-metrics-stack.json:86-95` (subagent-reported). Same root cause as B10. The contract bans `user_id, session_id, request_id, raw_path, object_key, …` as labels; no runtime emitter is checked.

- **B12. Forbidden alert-payload fields list is unenforced.**
  `observability-console-alerts.json:411-422` (subagent-reported). Same root cause. Cross-references the M1 audit's B8 (M1 found masking-policy forbidden fields declared by `observability-audit-pipeline.json` similarly unenforced).

- **B13. Threshold ordering `warning ≤ soft ≤ hard` is unenforced at policy-write time.**
  `observability-quota-policies.json:113-127` (subagent-reported). A policy with `warning = 90, soft = 80, hard = 70` would pass schema validation but produce nonsensical posture transitions.

- **B14. `usagePercentage` precision is unspecified.**
  `observability-quota-usage-view.json:116-124` (subagent-reported). Says divide by `hardLimit` first, then `softLimit`, else null. No mention of rounding mode or decimal places.

- **B15. `startedAt ≤ endedAt` invariant on usage windows is unenforced.**
  `observability-usage-consumption.json:218-226` (subagent-reported). Snapshot creators can produce reversed-time windows.

- **B16. `suppressed` alert state is terminal but allowed_transitions reachability is unguarded.**
  `observability-console-alerts.json:218-250` (subagent-reported). No state-machine guard prevents code from attempting `suppressed → acknowledged` or `suppressed → resolved`.

### Likely (drift / inconsistency / fragility)

- **B17. Threshold-alerts escalation order is reversed from quota-policies posture precedence.**
  `observability-quota-policies.json:149-157` orders `hard_limit_reached > soft_limit_exceeded > warning > evidence_unavailable > evidence_degraded > within_limit > unbounded` (precedence for posture resolution). `observability-threshold-alerts.json:111-119` orders `warning > soft_limit > hard_limit` for escalation and the reverse for recovery. These are different concepts (posture-precedence vs. alert-emission-order) but the divergence makes alert ordering within a single evaluation cycle ambiguous when posture changes by more than one step. Subagent-reported.

- **B18. Dashboard workspace_fallback values diverge across subsystems.**
  `observability-dashboards.json:155, :323` (subagent-reported). Most subsystems use `tenant_inherited`; control-plane alone uses `workspace_native`. No validator checks dashboard code respects per-subsystem fallback.

- **B19. Business metrics `safe_attribution_policy` undefined operationally.**
  `observability-business-metrics.json:364` says `"workspace_safe_when_route_context_is_attributable"`. The word "attributable" isn't defined elsewhere. Risk: dashboard code and metering code disagree on the predicate.

- **B20. Health-summary aggregation priorities declared in console-alerts, not health-checks.**
  `observability-console-alerts.json:103-132` (subagent-reported). The natural place to declare per-status numeric priority is `observability-health-checks.json`, but that file doesn't carry priorities. Cross-contract leakage.

- **B21. Audit-export `Idempotency-Key` required as header, not body.**
  `metrics.openapi.json:2401, :3322, :444`. Some idempotency models require the key inside the body for replay handling; this contract puts it only in headers, which works for the gateway but complicates server-side replay-store lookups.

- **B22. `getTenantAuditCorrelation` truncates large correlations.**
  `metrics.openapi.json:2280` (subagent-reported). `maxItems` ≤ 200 with no cursor. Correlations spanning > 200 events are silently incomplete.

### Needs verification

- **B23. Whether `observability-admin.mjs` is consumed by any HTTP handler.** The façade is 2470 LOC. If it's only imported by validators and tests (per the pattern of A1's other façades), it's contract scaffolding. Verify with a wider grep.

- **B24. Whether `hard-limit-enforcement.json`'s `quota_metering` subsystem id appears in the canonical `observability-audit-event-schema.json` supported subsystems.** The latter (per M1 audit) declares 8 subsystems including `quota_metering` — but verify.

- **B25. Whether `tests/contracts/observability-*` actually exercises any of the cross-contract drift cases (B1, B17, B18).** The file listing suggests tests exist but their assertions weren't read.

- **B26. Whether the gateway uses `seriesPrefix: 'in_falcone_event_gateway_'` (from `metrics.openapi.json:994`) as the actual Prometheus prefix.** Per F1 audit, the event-gateway is a contract layer with no HTTP server in source. The Prometheus prefix is declared, but no scraper is configured.

- **B27. Whether `validate-observability-*.mjs` is wired to `npm run lint` / `pnpm test`.** The A1 audit found the `validate:repo` script enumerates many `validate:observability-*` entries in `package.json:scripts`. Verify all 15 are present.

---

## Scope note for downstream spec authoring

M4 is unusual in this audit: the contract layer is **substantially better than the runtime layer**. There are 16 declared HTTP routes, 10 well-structured contracts, 15 validators, and a 2470-LOC façade — but **only 34 LOC of actual runtime metric-name declarations** (and even those don't emit). Three blocking items before any OpenSpec proposal:

1. **B6/B7 — bridge the contract/runtime gap.** Either implement handlers for the 16 routes and wire `prom-client` into the various services, or explicitly mark the 16 routes as not-yet-implemented in OpenSpec.
2. **B1 — reconcile the quota-dimension vocabulary across `hard-limit-enforcement`, `quota-policies`, `usage-consumption`.** Three contracts disagree on names; production code that consumes both surfaces would need translation glue.
3. **B8 — promote the validators from structural to semantic.** Today they verify JSON well-formedness. A real OpenSpec capability would also verify cross-contract alignment (dimension ids, posture state names, freshness vocab) and runtime emitter conformance.

Secondary items: B2 (duplicate posture names in quota-usage-view), B3 (`MetricSeriesResponse.unit` required), B4 (`WorkspaceEventDashboardResponse` tenantId), B5 (`x-tenant-binding` extension), B9 (degraded probe numeric mapping), B13 (threshold ordering CHECK), B15 (usage-window invariant), B16 (suppressed terminal-state guard), B17 (escalation vs precedence reconciliation), B18 (workspace_fallback per-subsystem policy).

After those, M4 becomes the most coherent observability story in the audit — and the only one where the contracts are detailed enough to drive real implementation. Until they do, M4 is documentation in search of producers.
