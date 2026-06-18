# observability — spec delta for fix-apisix-metrics-target

## ADDED Requirements

### Requirement: APISIX exposes a scrapable Prometheus metrics endpoint

The API gateway SHALL expose Prometheus metrics in exposition format at
`/apisix/prometheus/metrics` on the gateway port that Prometheus scrapes, and SHALL collect
request metrics (status, latency, bandwidth) for every proxied route. The Prometheus scrape
target for the gateway SHALL therefore be UP, returning metric series rather than HTML.

#### Scenario: the metrics endpoint returns Prometheus exposition

- **WHEN** Prometheus scrapes `/apisix/prometheus/metrics` on the gateway
- **THEN** the response is Prometheus exposition format (not the web-console HTML), so the scrape target is UP

#### Scenario: proxied requests are counted

- **WHEN** requests flow through the gateway and the metrics endpoint is scraped
- **THEN** per-route request metrics (status/latency/bandwidth) are present in the exposition
