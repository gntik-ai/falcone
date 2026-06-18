# fix-console-operator-tenant-context

## Change type
bugfix

## Capability
web-console

## Priority
P1

## Why
The tenant-switcher calls `GET /v1/tenants` (`auth:'superadmin'`) → operators get 403 → zero tenant context → every tenant-scoped page is empty. `GET /v1/tenant/plan`+`/limits` (My-plan) and the Members panel also 403 for the operator's own tenant.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: logged in as `acme-ops` (tenant_owner), the console loads no tenant context; My-plan/Members 403.

GitHub issue #569 (epic #546). Evidence: `audit/live-campaign/evidence/27-console-parity.md`.

## What Changes
Drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the superadmin tenant list; fix the singular `/v1/tenant/plan` route authz — `apps/web-console` + the control-plane plan routes.

## Impact
An operator logs in and sees their own tenant/workspaces/plan.
