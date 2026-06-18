# fix-apisix-metrics-target

## Change type
bugfix

## Capability
observability

## Priority
P2

## Why
The APISIX Prometheus target is DOWN (returns HTML, not Prometheus exposition) -> 4/5 targets UP.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: `/api/v1/targets` shows the APISIX target DOWN; other targets UP; Grafana dashboards otherwise show real data.

GitHub epic F. Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

## What Changes
Expose an APISIX metrics endpoint and point the scrape config at it.

## Impact
The APISIX scrape target is UP.
