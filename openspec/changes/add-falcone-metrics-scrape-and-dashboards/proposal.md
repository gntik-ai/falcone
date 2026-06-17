Tracking issue: gntik-ai/falcone#499

## Why

The in-chart Falcone Prometheus scrapes only itself (1 target, 0 Falcone metrics); there is no ServiceMonitor for the control-plane or executor, Grafana ships 0 Falcone dashboards, and the metrics API returns zeros. There is effectively no per-tenant or application observability on the live stack.

(Evidence: `tests/live-audit/evidence/13-metrics.md`.)

## What Changes

- Corrected scope after reading the deploy: the pipeline was MORE broken than "missing ServiceMonitors" — the in-cluster Prometheus mounted no config at all (ran the default, scraped only itself) and no Grafana was deployed.
- Expose a Prometheus `/metrics` endpoint on the control-plane and executor, backed by a zero-dep in-process registry (`metrics-registry.mjs`) recording HTTP request counts + a latency histogram with bounded route/status/tenant labels.
- Render a real `prometheus.yml` (scrape control-plane/executor/apisix `/metrics`) and mount it into the observability Deployment with `--config.file` (it previously had no config volume).
- Deploy Grafana (Deployment + Service) with a provisioned Prometheus datasource and Falcone dashboards (platform overview + per-tenant), built on the `falcone_*` metrics.
- Back the metrics API `series()` with a real Prometheus PromQL query (it returned a hardcoded empty array before).

## Capabilities

### New Capabilities

- `audit`: Falcone application/tenant metrics are scraped by Prometheus, surfaced in Falcone dashboards, and served by the metrics API.

### Modified Capabilities

## Impact

- Helm chart: ServiceMonitors + `/metrics` exposure for control-plane/executor; Grafana dashboard provisioning.
- Metrics API backing series.
