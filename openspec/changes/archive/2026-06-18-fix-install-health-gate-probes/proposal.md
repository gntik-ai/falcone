# fix-install-health-gate-probes

## Change type
bugfix

## Capability
deployment

## Priority
P2

## Why
`install.sh` probes `apisix /health` (404 — the gateway proxies it to an upstream path that 404s; `/v1/*` routing works) and `ferretdb:27017` from an unlabeled smoke pod (netpol-blocked though reachable from the executor) -> false health-gate failures.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: gate FAILs on apisix /health (but POST /v1/auth/login-sessions -> 400, GET /v1/tenants -> 401) and ferretdb TCP (but ferretdb TCP OK from the executor pod).

GitHub epic F. Evidence: `audit/live-campaign/evidence-rerun/00-stack-and-install.md`.

## What Changes
Probe paths/clients that reflect real health (e.g. a known-routed `/v1/*` path; an allowed client for ferretdb).

## Impact
The health gate passes when the platform is actually healthy.
