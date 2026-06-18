# fix-audit-enforcement-logging

## Change type
bugfix

## Capability
audit

## Priority
P2

## Why
Quota denials (402) and cross-tenant denials (403) fire but `quota_enforcement_log` and `scope_enforcement_denials` stay empty.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: a 4th-workspace create -> 402 QUOTA_EXCEEDED and a cross-tenant access -> 403, yet both tables have 0 rows.

GitHub epic C. Evidence: `audit/live-campaign/evidence-rerun/10-tenant-project-quota-provisioning-audit.md`.

## What Changes
Write an audit record at each enforcement point with the correlation id.

## Impact
A 402/403 produces a correlated audit row.
