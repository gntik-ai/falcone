# add-enduser-lifecycle-management

## Change type
enhancement

## Capability
tenant-rbac

## Priority
P1

## Why
Owner end-user routes are create+list only; `DELETE .../users/{id}` and status PATCH are in the catalog but return NO_ROUTE → the owner cannot disable/delete a registered app end-user.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: `DELETE /v1/iam/realms/{realm}/users/{id}` and status PATCH → 404 NO_ROUTE.

GitHub issue #567 (epic #545). Evidence: `audit/live-campaign/evidence/25-auth-enduser.md`.

## What Changes
Implement the disable/delete (and status) end-user routes scoped to the owner's realm — kind `b-handlers.mjs` (iam) + product IAM service.

## Impact
Owner disables then deletes an app end-user; the user can no longer authenticate.
