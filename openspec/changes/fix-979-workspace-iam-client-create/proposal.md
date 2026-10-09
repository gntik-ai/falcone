## Why

CreateIamClientWizard submits POST /v1/workspaces/{workspaceId}/iam/clients, but the
control-plane route is absent and the catalog labels it a Keycloak creation gap.
Applications cannot provision their OIDC clients through the supported API.

## What Changes

- Add the workspace-scoped creation route, handler, runtime map entry and image packaging.
- Reuse workspace management authorization and derive the realm from workspace to tenant.
- Validate identifiers, flows, redirect targets, web origins and realm-offered scopes.
- Create and re-read public, confidential or service-account clients using kcAdmin.
- Require ownership attributes for replay; return an equivalent client without another secret.
- Normalize provider failures, compensate this attempt's client, and audit redacted configuration
  with the realized UUID and compensation outcome.
- Add boundary tests, wizard payload assertions and a scheduled real API/Keycloak PKCE test.

## Capabilities

### Added Capabilities

- `iam`: workspace-owned OIDC client creation.

## Impact

No migration, gateway auth change or deployment template change is needed. The chart loads the
runtime map packaged in the control-plane image; it carries no separate route-map copy. Existing
external application semantics and built-in scope restrictions remain in place. Rollback uses
the previous image digest; clients remain discoverable by their workspace ownership tags.

The authority is superadmin or the owning tenant's owner/admin. A workspace role with only
manage_iam is insufficient. Confidential and service-account secrets are returned once on create.
