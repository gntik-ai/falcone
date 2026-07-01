# web-console - spec delta for fix-740-auth-iam-permission-gate

## ADDED Requirements

### Requirement: Navigation and routes reflect IAM permissions

The console SHALL align IAM navigation entries and direct IAM routes with the caller's effective IAM
permissions. A role that cannot use a fully rendered IAM page SHALL NOT be presented with that page
as an actionable navigation destination, and direct route access SHALL fail closed before the page
loads any unauthorized IAM inventory calls. If an IAM surface is platform/superadmin-only, it SHALL be
hidden from non-superadmin navigation and direct access SHALL redirect to an allowed console page
rather than rendering a permanent `403 requires superadmin` dead-end. If a future IAM surface grants
tenant owners scoped own-realm access, that surface SHALL load only the authorized tenant realm.

#### Scenario: Tenant owner opens the Auth/IAM page

- **WHEN** a tenant owner opens `/console/auth`
- **THEN** they do not see the Auth/IAM entry if the page is superadmin-only
- **AND THEN** direct URL access redirects to an allowed console page before `ConsoleAuthPage` mounts
- **AND THEN** the console does not issue the page's superadmin-only IAM inventory calls for that
  tenant-owner session
- **AND THEN** the tenant owner does not land on a `403 requires superadmin` Auth/IAM dead-end

#### Scenario: Superadmin opens the Auth/IAM page

- **WHEN** a superadmin opens the console navigation or navigates directly to `/console/auth`
- **THEN** the Auth/IAM entry remains visible
- **AND THEN** `/console/auth` renders the Auth/IAM page as before
