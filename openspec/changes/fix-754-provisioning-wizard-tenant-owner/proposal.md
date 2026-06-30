## Why

Issue #754 is a confirmed web-console authorization mismatch. Tenant owners can be authorized by
the control-plane to provision workspace databases and publish functions, but the console wizard
permission gate only admitted `workspace_admin` for `provision_database` and `publish_function`.
That made `/console/postgres`, `/console/mongo`, and `/console/functions` show "Acceso bloqueado"
before the API could make the authoritative authorization decision.

## What Changes

- Update `apps/web-console/src/lib/console-wizards.ts` so `provision_database` and
  `publish_function` admit `tenant_owner` as well as `workspace_admin`, while preserving the existing
  global `superadmin` / `platform_operator` allow path and preserving denial for `tenant_member` or
  empty-role sessions.
- Add focused web-console regression tests:
  - `ProvisionDatabaseWizard.test.tsx` covers `tenant_owner` opening and completing the
    create-database wizard for both PostgreSQL and MongoDB defaults, with no blocked panel.
  - `PublishFunctionWizard.test.tsx` covers `tenant_owner` opening and completing the publish
    wizard, asserting the request reaches the mocked API layer instead of being pre-empted by a
    stricter client gate.
  - Both files keep explicit low-privilege denial coverage.
- Add a short architecture reference note for console wizard permission gates and the rule that
  client gates must not be stricter than server authorization for the same role.
- No backend, OpenAPI, generated SDK/client, route catalog, or wire contract artifact changes are
  needed. The API already authorizes `tenant_owner`; this fix aligns the frontend gate with that
  backend behavior.

## Capabilities

### Modified Capabilities

- `web-console`: modify the provisioning wizard permission-gate requirement so
  `provision_database` and `publish_function` allow `tenant_owner` OR `workspace_admin`, and so the
  console does not pre-empt an API-authorized role with a stricter client-side check.
