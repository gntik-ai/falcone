# fix-console-operator-shell

## Change type
bugfix

## Capability
web-console

## Priority
P1

## Why
`/console/my-plan` (and plans/tenants) call superadmin-only routes -> 403 for tenant_owners (no role gate); `/v1/console/session` is referenced in the SPA bundle but returns 404.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: as `acme-ops` (tenant_owner), my-plan/plans/tenants -> 403; `/v1/console/session` -> 404.

GitHub epic F. Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

## What Changes
Drive operator pages from operator-authorized routes (own-scope) or hide them by role; remove/implement `/v1/console/session`.

## Impact
An operator logs in and sees their own tenant/plan/workspaces; no dead session route.
