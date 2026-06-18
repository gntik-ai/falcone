# fix-metrics-tenant-authorization

## Change type
bugfix

## Capability
tenant-isolation

## Priority
P0

## Why
`/v1/metrics/tenants/{id}/*` and `/v1/metrics/workspaces/{id}/*` accept any id; a tenant operator reads another tenant's metrics including real non-empty time-series.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** `acme-ops` → `GET /v1/metrics/workspaces/{globex-ws}/series` → 200 with globex's `http_requests_per_second` series; quotas/overview/usage/audit-records for globex → 200; a non-existent id → 200. Root: `metrics-handlers.mjs` doesn't enforce caller `tenant_id` == path id.

GitHub issue #549 (epic #539). Evidence: `audit/live-campaign/evidence/26-lifecycle-governance.md`.

## What Changes
Apply the own-tenant guard used by `/plan/*` (tenant_owner→own only, superadmin→any) to ALL metrics routes, in the kind `metrics-handlers.mjs` and the product metrics handler.

## Impact
Cross-tenant metrics → 403; own → 200; live probe.
