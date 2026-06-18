# fix-backup-scope-schema

## Change type
bugfix

## Capability
backup-restore

## Priority
P1

## Why
`GET /v1/admin/backup/scope` and `/v1/tenants/{id}/backup/scope` reach the handler (superadmin) but 500 with PostgreSQL `42P01` (undefined_table) — `deployment_profile_registry`/`backup_scope_entries` are not created. The `services/backup-status` service + the routes exist; only the schema is missing. (Capability was initially mis-reported as not-deployed; it is deployed-but-broken.)

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: superadmin `GET /v1/admin/backup/scope` -> 500 `{code:42P01}`; acme-ops `GET /v1/tenants/{globex}/backup/scope` -> 403 (isolation holds).

GitHub epic C. Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

## What Changes
Add the backup-scope schema (deployment_profile_registry + backup_scope_entries) to the governance/backup migration set.

## Impact
Backup scope returns 2xx for an authorized caller; cross-tenant stays 403.
