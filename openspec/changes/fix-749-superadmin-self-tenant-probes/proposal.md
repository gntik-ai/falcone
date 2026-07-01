# Change: fix-749-superadmin-self-tenant-probes

## Why

Issue #749 is a confirmed web-console bug for tenant-less platform principals. A `superadmin`
session has no own tenant context, but the console shell still resolved capability gates through the
self-tenant endpoint `/v1/tenant/effective-capabilities`, producing a 404 on every console page. The
`/console/my-plan` page also called `/v1/tenant/plan/effective-entitlements` and rendered the raw
backend code `TENANT_NOT_FOUND`.

The platform admin account has no personal tenant plan. Self-tenant calls must be gated by tenant
context, and the My Plan page must show a meaningful platform-admin state instead of exposing a raw
backend error.

## What Changes

- `apps/web-console/src/lib/console-context.tsx` now passes `activeTenantId` to
  `getEffectiveCapabilities(activeTenantId)`, so capability loading uses
  `/v1/tenants/{tenantId}/effective-capabilities` when a tenant is selected and skips loading when no
  tenant is active. It no longer uses `/v1/tenant/effective-capabilities` from the shell.
- `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` detects tenant-less platform
  principals (`superadmin`, `platform_admin`, `platform_operator` with no `tenantIds`) before loading
  My Plan. Those users see `No personal plan (platform admin)` and the page does not call
  `/v1/tenant/plan/effective-entitlements`. Tenant-user behavior is preserved.
- Focused web-console tests encode the regression:
  - `ConsoleContextProvider` with a tenant-less superadmin session does not fetch
    `/v1/tenant/effective-capabilities` and uses the active tenant route instead.
  - My Plan renders the platform-admin no-personal-plan state without raw `TENANT_NOT_FOUND` and
    without calling self-tenant entitlements.
  - The existing tenant My Plan happy path remains covered.
- Docs now describe the self-tenant route invariant and the platform-admin My Plan state.
- No backend, OpenAPI, AsyncAPI, generated SDK, or shared contract artifact change is required: the
  frontend now uses existing tenant-id routes and skips invalid self-tenant calls.

## Capabilities

### Modified Capabilities

- `web-console`: modifies self-tenant capability and plan loading behavior for tenant-less platform
  principals.
