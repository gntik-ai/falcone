# add-tenant-owner-enduser-management

## Change type
enhancement

## Capability
iam

## Priority
P1

## Why
A tenant_owner cannot list its own app end-users (`GET /v1/iam/realms/{id}/users` -> 403 superadmin-only); there is no owner-facing end-user management API (list/view/disable/delete).

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: as a tenant_owner, listing the project's end-users -> 403; disable/delete are superadmin-only.

GitHub epic D. Evidence: `audit/live-campaign/evidence-rerun/11-auth-iam-appauth-keys.md`.

## What Changes
A project-scoped end-user management API authorized for the owning tenant.

## Impact
An owner lists/disables/deletes only its own project's end-users; cross-tenant denied.
