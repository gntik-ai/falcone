Tracking issue: gntik-ai/falcone#504

## Why

The web console's "new tenant" wizard POSTs to `/v1/admin/tenants`, which returns 404 (`NO_ROUTE`) — that route is not in the catalog. The live control-plane, APISIX, and the 392-route public catalog expose only `POST /v1/tenants`. As a result, UI-driven tenant creation fails. (Several other console admin calls also use the non-existent `/v1/admin/tenants/{id}/config/*`.)

Live proof (`tests/live-audit/evidence/12-console-parity.md`, CONS-1): `submitWizardRequest('/v1/admin/tenants', …)`; `GET/POST /v1/admin/tenants` → `404 {"code":"NO_ROUTE"}`.

## What Changes

- Point the console "new tenant" wizard (and related admin calls) at the real `POST /v1/tenants` route so tenant creation from the console succeeds.

## Capabilities

### New Capabilities

- `web-console`: Creating a tenant from the console targets the real control-plane route and succeeds.

### Modified Capabilities

## Impact

- Console wizard request target (`submitWizardRequest('/v1/admin/tenants', …)` → `/v1/tenants`).
- Related `/v1/admin/tenants/{id}/config/*` console calls.
