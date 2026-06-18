# fix-quota-read-tenant-scope

## Change type
bugfix

## Capability
tenant-isolation

## Priority
P2

## Why
`/v1/tenants/{id}/quota/effective-limits` and `/quota/audit` return 200 cross-tenant (payloads empty today, but the authz check is absent — leaks once quota state is populated).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** `acme-ops` → `GET /v1/tenants/{globex}/quota/effective-limits|audit` → 200 (no 403).

GitHub issue #552 (epic #539). Evidence: `audit/live-campaign/evidence/26-lifecycle-governance.md`.

## What Changes
Add the own-tenant guard used by `/plan/*` to the quota read routes (kind + product).

## Impact
Cross-tenant quota reads → 403.
