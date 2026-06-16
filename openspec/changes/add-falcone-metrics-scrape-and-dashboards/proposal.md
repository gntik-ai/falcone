Tracking issue: gntik-ai/falcone#499

## Why

The in-chart Falcone Prometheus scrapes only itself (1 target, 0 Falcone metrics); there is no ServiceMonitor for the control-plane or executor, Grafana ships 0 Falcone dashboards, and the metrics API returns zeros. There is effectively no per-tenant or application observability on the live stack.

(Evidence: `tests/live-audit/evidence/13-metrics.md`.)

## What Changes

- Add ServiceMonitors for the control-plane and executor and expose `/metrics` on those services.
- Ship Falcone Grafana dashboards (including a per-tenant view).
- Back the metrics API with the real Prometheus series so it no longer returns zeros.

## Capabilities

### New Capabilities

- `audit`: Falcone application/tenant metrics are scraped by Prometheus, surfaced in Falcone dashboards, and served by the metrics API.

### Modified Capabilities

## Impact

- Helm chart: ServiceMonitors + `/metrics` exposure for control-plane/executor; Grafana dashboard provisioning.
- Metrics API backing series.
