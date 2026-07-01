# Tasks — fix-754-provisioning-wizard-tenant-owner

## 1. Reproduce / encode acceptance

- [x] Confirm issue root cause: `apps/web-console/src/lib/console-wizards.ts` allowed only
  `workspace_admin` for `provision_database` / `publish_function`, while the issue evidence shows the
  backend does not return `403` for `tenant_owner`.
- [x] Add database wizard regression coverage for the issue scenario: a `tenant_owner` with an
  active workspace sees and completes the create-database wizard for PostgreSQL and MongoDB without
  an "Acceso bloqueado" panel.
- [x] Add publish-function wizard regression coverage for the issue scenario: a `tenant_owner` sees
  and completes the publish wizard, and the submit reaches the API request layer.
- [x] Keep negative coverage for `tenant_member` and empty-role sessions.

## 2. Fix

- [x] Update `useWizardPermissionCheck` so `provision_database` and `publish_function` allow
  `tenant_owner` OR `workspace_admin`.
- [x] Preserve existing `superadmin` / `platform_operator` behavior.
- [x] Preserve denial for `tenant_member` and no-role sessions.

## 3. Contract / docs / OpenSpec

- [x] No backend, OpenAPI, generated SDK/client, gateway route, request/response shape, or status
  code change is required; the backend remains the final authorization authority.
- [x] Materialize the OpenSpec delta under `openspec/changes/fix-754-provisioning-wizard-tenant-owner/`.
- [x] Document the console wizard permission-gate invariant in
  `docs/reference/architecture/console-wizard-permission-gates.md`.

## 4. Verify

- [x] Run focused web-console Vitest coverage for `ProvisionDatabaseWizard` and
  `PublishFunctionWizard`.
- [x] Run `openspec validate fix-754-provisioning-wizard-tenant-owner --strict` if the local
  OpenSpec CLI is available.
