# fix-iam-route-wiring

## Change type
bugfix

## Capability
iam

## Priority
P2

## Why
`getIamUser`, `getIamRole`/`deleteIamRole`, and realm CRUD are in the route catalog but return 404 in the deployed runtime.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: `GET /v1/iam/realms/{id}/users/{userId}`, `GET/DELETE .../roles/{name}`, and realm CRUD -> 404 NO_ROUTE.

GitHub epic D. Evidence: `audit/live-campaign/evidence-rerun/11-auth-iam-appauth-keys.md`.

## What Changes
Register the handlers (or remove them from the catalog).

## Impact
Catalogued IAM routes resolve to their handlers.
