# Console tenant/workspace context consistency

The web console keeps the active context in `ConsoleContextProvider`
(`apps/web-console/src/lib/console-context.tsx`). The active tenant drives the workspace list loaded
from `GET /v1/workspaces?filter[tenantId]=...`, and the active workspace is selected from that list.

## Tenant selection events

Selecting a different tenant clears the previous active workspace, clears the previous workspace
list, and lets the existing workspace loader fetch workspaces for the new tenant. This prevents a
workspace from one tenant from remaining active under another tenant.

Selecting the tenant that is already active is idempotent when workspace state is healthy: the
console preserves the current workspace list and active workspace instead of clearing them. If the
active tenant already has an empty or errored workspace list, the same-tenant event increments the
workspace reload key so the existing loader issues another `GET /v1/workspaces`.

## Empty workspace recovery

The shell offers `Reintentar workspaces` not only when a workspace request returns an explicit error,
but also when an active tenant has an empty, non-loading workspace list. This gives operators a
manual recovery path if frontend state is ever cleared without a backend error. A genuinely empty
tenant still renders the empty workspace option, but the retry path remains available and harmless.

## Scope

This behavior is frontend-only. It uses the existing workspace list endpoint and reload path; it does
not change OpenAPI or AsyncAPI schemas, generated clients, response shapes, status codes, auth
claims, backend routes, route catalog artifacts, or realtime event payloads.
