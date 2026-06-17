# Evidence — Metrics / Observability (live)

## Falcone metrics API (control-plane `/v1/metrics/workspaces/{ws}/…`)

- ACTIVE (200) routes: `overview`, `usage`, `series`, `quotas`, `audit-records`.
- NOT wired (404, advertised in catalog): `kafka-topics`, `event-dashboards`, `gateway-streams`.
- **MET-1 (MED): metrics API returns structure but NO real data.**
  `overview` → every dimension `measuredValue:0, freshnessStatus:"unavailable"`;
  `usage` → every dimension `value:0, points:[]`. So tenant/workspace usage is never measured
  (matches QUOTA-1 `CONSUMPTION_QUERY_FAILED`). Dashboards built on these would show zeros.

## Prometheus / Grafana

- Platform stack `platform-observability` (kube-prometheus-stack + Grafana 11.3 + Loki + Jaeger)
  is deployed and Grafana is healthy (datasources Prometheus/Loki/Jaeger all present).
- **MET-2 (MED): the Falcone in-chart Prometheus scrapes nothing.**
  `falcone-observability` Prometheus (`:9090`) `api/v1/targets?state=active` → **1 target (itself,
  job=prometheus)**. `__name__` values → 279 names, **0 falcone-* metrics**. No ServiceMonitor exists
  for `falcone-control-plane`/`falcone-cp-executor`. Falcone app components are not scraped.
- **MET-3 (MED): no Falcone dashboards.** Grafana has 58 dashboards, **0 Falcone-named** (titles are
  another product's: Accounts, Billing, Stripe lifecycle, Cost Governance, Frontend Web Logs…).
- Platform Prometheus scrape health also looks degraded: `count by(job)(up==1)` returned only
  `otel-collector=1`; `up{namespace="falcone"}` → 0 targets. (Secondary; the platform stack is
  adjacent to Falcone.)

## Status

| Functionality | Status |
|---|---|
| Metrics API overview/usage/series/quotas/audit | Active (routes) but **no real data** (MET-1) |
| Falcone app metrics scraped by Prometheus | **Broken** (MET-2, 0 targets/metrics) |
| Grafana deployed | Active |
| Grafana shows Falcone tenant data | **Broken** (MET-3, no dashboards, no data) |
| Infra (kube) monitoring | Partial (stack up; scrape health degraded) |

Net: observability infrastructure is deployed, but **Falcone application/tenant metrics do not flow
and no Falcone dashboards show data** — the "dashboards show real data" goal is not met for Falcone.
