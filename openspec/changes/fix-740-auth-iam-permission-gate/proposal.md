# Change: fix-740-auth-iam-permission-gate

## Why

Issue #740 is a confirmed web-console permission mismatch. The shell navigation offers the Auth/IAM
page at `/console/auth` to tenant-owner sessions, and the router renders the page directly for any
authenticated console user. The page then loads platform IAM inventory with calls such as
`GET /v1/iam/realms/{realmId}/roles` and `/clients`, which are superadmin-only today. A tenant owner
therefore lands on a permanent `403 requires superadmin` state for a page the console invited them to
open.

For this fix, `/console/auth` remains a platform/superadmin-only surface. Tenant-owner scoped IAM
work is not widened in the backend in this change.

Reviewer follow-up found the adjacent `/console/iam-access` surface already guarded by the same
superadmin route gate, while its shell navigation entry still appeared for non-superadmin sessions.
That made the broader IAM navigation requirement internally inconsistent even though the original
issue acceptance remains centered on `/console/auth`.

## What Changes

- Mark the Auth and IAM Access navigation entries as superadmin-only and hide them for
  non-superadmin console sessions.
- Guard the direct `/console/auth` route with the existing `RequireSuperadminRoute`, redirecting
  non-superadmin sessions to `/console/my-plan` before `ConsoleAuthPage` mounts.
- Preserve the existing `/console/iam-access` route guard and superadmin behavior for the Auth and
  IAM Access pages.
- Add focused web-console regression tests for tenant-owner nav hiding, tenant-owner direct URL
  redirects without rendering platform IAM pages, and superadmin positive controls.
- Document that `/console/auth` and `/console/iam-access` are currently platform/superadmin-only.

## Scope

This change does not alter backend IAM authorization, control-plane routes, OpenAPI/AsyncAPI shapes,
generated clients, request/response schemas, or status codes. Tenant owner user and membership
management remains in the tenant/member-oriented console surfaces; future scoped tenant IAM work can
introduce a separate own-realm model without changing this superadmin-only platform page.

## Capabilities

### Added Capabilities

- `web-console`: console navigation and direct routes for IAM pages reflect the caller's effective
  permissions instead of presenting fully unusable superadmin-only platform IAM pages to tenant
  owners.
