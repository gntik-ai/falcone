## 1. Failing tests

- [ ] 1.1 [test] Add `services/metrics-api/test/handlers.test.mjs` that
      enumerates the 16 operationIds in `metrics.openapi.json` and asserts
      each one resolves to a handler function exported by
      `services/metrics-api/src/handlers/index.mjs` (proves B6's invariant).
- [ ] 1.2 [test] Add `services/metrics-runtime/test/prometheus-recorder.test.mjs`
      that asserts a recorder created via `createPrometheusRecorder({...})`
      registers the 6 `plan_change_history_*` names plus the new metric
      names introduced for the 16 routes, and that recording a sample is
      reflected in the `/metrics` text exposition.
- [ ] 1.3 [test] Add a case that asserts `recordMetric(recorder, name,
      value, tags)` in `plan-change-impact-metrics.mjs` now calls the
      registered Prometheus counter/histogram on the recorder (proves B7's
      invariant: the module no longer ships a no-op).
- [ ] 1.4 [test] Add `services/metrics-api/test/observability-admin-delegation.test.mjs`
      that asserts a façade getter previously returning a contract default
      now returns the value the reader supplies for a sample tenant.

## 2. Implementation

- [ ] 2.1 [impl] Create `services/metrics-runtime/` with
      `createPrometheusRecorder()`, `createKafkaEmitter()`, and a
      `MetricsRegistry` that owns all metric definitions; declare
      `prom-client` as a dependency.
- [ ] 2.2 [impl] Create `services/metrics-api/` (Fastify) with one handler
      per operationId under `src/handlers/`; each handler resolves
      tenant/workspace context from gateway-injected headers and rejects
      unbound calls; reads come from `MetricsReader` (Prometheus
      `query_range` + Kafka audit-topic consumer).
- [ ] 2.3 [impl] Replace
      `services/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs:32-34`
      `recordMetric(recorder, ...)` indirection with a direct import of
      `getOrchestratorRecorder()` from `services/metrics-runtime/`.
- [ ] 2.4 [impl] Wire `apps/control-plane/src/observability-admin.mjs`
      getters that compute summaries from contract defaults to delegate to
      `MetricsReader` so the façade returns real data.
- [ ] 2.5 [migration] Add `services/gateway-config/routes/metrics.yaml`
      with the 16 routes mapped to `services/metrics-api/`, each requiring
      `observability:read` (tenant scope) or `observability:admin:read`
      (cross-tenant); update `helm/` chart values to add a scrape target
      for the new service.

## 3. Validation

- [ ] 3.1 [docs] Document the recorder/emitter distinction and the
      MetricsReader interface in `services/metrics-runtime/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:unit`, the metrics-api
      integration tests, and `openspec validate
      complete-m4-metrics-handlers --strict`; all green before merge.
