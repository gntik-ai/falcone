# Tasks — fix-apisix-metrics-target

## Reproduce (test-first)
- [x] Confirmed via the observability contract (`tests/contracts/observability-metrics-stack.contract.test.mjs`)
      that the gateway scrape target's `metrics_path` is `/apisix/prometheus/metrics`, and from
      `charts/in-falcone/templates/observability-prometheus-config.yaml` that Prometheus scrapes the gateway
      service at `:9080` on that path — which had no route and fell through to the web-console (HTML → target DOWN).

## Implement (kind runtime AND shippable product as applicable)
- [x] `deploy/kind/apisix/apisix.yaml`: add a `public-api` route at `/apisix/prometheus/metrics` (highest
      priority, GET) so the gateway serves the Prometheus export endpoint on `:9080` instead of proxying to
      the console; add a `global_rules` entry enabling the `prometheus` plugin for every request.
- [x] No scrape-config change needed: the chart's `falcone-apisix` Prometheus job already targets that
      service/port/path (it just had nothing to scrape).

## Verify
- [x] `deploy/kind/apisix/apisix.yaml` parses (YAML); the metrics route + global prometheus rule are present.
- [x] `node --test tests/contracts/observability-metrics-stack.contract.test.mjs` green (scrape path unchanged at `/apisix/prometheus/metrics`).
- [x] Acceptance: the APISIX scrape target is UP (serves Prometheus exposition, not HTML).

## Archive
- [ ] `openspec validate fix-apisix-metrics-target --strict`; `/opsx:archive fix-apisix-metrics-target` after merge.
