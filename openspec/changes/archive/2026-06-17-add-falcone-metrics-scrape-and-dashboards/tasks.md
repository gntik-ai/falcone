## 1. Failing black-box test

- [x] 1.1 Add a test asserting Prometheus scrapes a Falcone target with non-zero metrics. — deterministic unit coverage of the registry in `tests/unit/metrics-registry.test.mjs` (counter + cumulative histogram + bounded route normalization). Live on test-cluster-b: Prometheus scrapes `falcone-control-plane` and `falcone-cp-executor` (both targets UP) and `falcone_http_requests_total` has real series (control-plane 2, executor present). RED before: Prometheus mounted no config and scraped only itself.
- [x] 1.2 Metrics API returns a real series. — live: `GET /v1/metrics/tenants/{t}/series` now returns `source: "prometheus"` (queries Prometheus via PromQL), vs the previous hardcoded `{points:[]}`.

## 2. Wire metrics + dashboards

- [x] 2.1 Expose `/metrics` + scrape it. — control-plane (`deploy/kind/control-plane/server.mjs`) and executor (`apps/control-plane/src/runtime/server.mjs`) serve `/metrics` from a shared zero-dep registry (`metrics-registry.mjs`), instrumenting every request (method/route/status/tenant + latency). A real `prometheus.yml` (`templates/observability-prometheus-config.yaml`) scrapes them and is mounted into the observability Deployment via `--config.file` + `extraVolumes`/`extraVolumeMounts`. (The deployed Prometheus is a plain Deployment, so a static scrape config is used rather than ServiceMonitors.)
- [x] 2.2 Provision Falcone Grafana dashboards (incl per-tenant). — `templates/grafana.yaml`: a Grafana Deployment + Service, a provisioned Prometheus datasource, and two dashboards (Falcone — Platform Overview, Falcone — Per-Tenant) built on `falcone_*`. `grafana:` values stanza added.
- [x] 2.3 Back the metrics API with Prometheus. — `metrics-handlers.mjs::series()` queries `PROMETHEUS_URL` (default `falcone-observability:9090`) `/api/v1/query_range` for the tenant's request rate; graceful empty fallback if unreachable.

## 3. Verify

- [x] 3.1 Re-run — Prometheus scrapes Falcone targets; dashboards present. — LIVE on test-cluster-b (control-plane `0.6.3-c1`, executor `0.9.6-c1`, observability reconfigured, Grafana deployed): both `/metrics` endpoints expose `falcone_http_requests_total`; Prometheus targets control-plane + executor UP with real series; `series()` → `source:prometheus`; Grafana health ok, datasource → Prometheus, both dashboards provisioned, and a grafana→Prometheus proxy query returns `falcone_*` data.
- [x] 3.2 Run `bash tests/blackbox/run.sh` — no regressions (the /metrics endpoint is additive; servers otherwise unchanged).
