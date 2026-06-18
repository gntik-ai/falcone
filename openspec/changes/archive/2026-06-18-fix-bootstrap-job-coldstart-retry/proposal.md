# fix-bootstrap-job-coldstart-retry

## Change type
bugfix

## Capability
tenant-provisioning

## Priority
P2

## Why
`falcone-in-falcone-bootstrap` → Failed (`backoffLimit:1`, KC not Ready on the single retry); realm + governance config not provisioned unless re-run. The bootstrap LOGIC is correct (re-running the pod completes).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: Job BackoffLimitExceeded on first install; manually running the same pod a minute later provisions realm+roles+clients+superadmin and exits 0.

GitHub issue #558 (epic #542). Evidence: `audit/live-campaign/evidence/../REPORT.md`.

## What Changes
Raise `backoffLimit`/retry budget and/or add a Keycloak-readiness wait init-container to the bootstrap Job (chart).

## Impact
Bootstrap completes on a cold `helm install` without manual re-run.
