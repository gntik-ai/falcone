## Why

`services/provisioning-orchestrator/src/collectors/iam-collector.mjs:70` establishes the convention `const realm = tenantId` — every tenant's Keycloak realm name equals its tenant ID, making realm IDs guessable from values exposed in tokens and API responses.

The entire IAM admin route family (`/v1/iam/realms/{realmId}/…`) in `apps/control-plane/openapi/families/iam.openapi.json` carries no `{tenantId}` path segment, unlike every other Falcone capability family which anchors the caller's tenant via `/v1/tenants/{tenantId}/workspaces/{workspaceId}/…`. The `x-scope: "tenant"` OpenAPI extension is a documentation annotation with no runtime enforcement effect.

`services/adapters/src/keycloak-admin.mjs::validateIamAdminRequest:285-323` validates `resourceKind`, `action`, `providerVersion`, and reserved realm IDs, but its signature does NOT receive `tenantId` and contains no `context.realmId === tenantId` assertion. `services/adapters/src/keycloak-admin.mjs::buildIamAdminAdapterCall:471-519` receives `tenantId` (line 477) but does NOT pass it into `validateIamAdminRequest` (line 489). `apps/control-plane/src/iam-admin.mjs` is a metadata-only module with no exported symbols that receive or compare a `tenantId` against the caller's identity.

The confirmed exploit at code-search level: a tenant A admin can issue `DELETE /v1/iam/realms/{realmId_of_B}/users/{userId}` with no Falcone-layer rejection (source finding `iso-003 / bug-007`).

## What Changes

- Add a `tenantId` parameter to `validateIamAdminRequest` in `keycloak-admin.mjs`.
- For non-platform-scoped requests (`context.scope !== 'platform'`), assert `context.realmId === tenantId` inside `validateIamAdminRequest`; return HTTP 403 before constructing or issuing any Keycloak admin call when the assertion fails.
- In `buildIamAdminAdapterCall`, pass `tenantId` into `validateIamAdminRequest` (currently omitted at line 489).
- Platform-scoped callers retain cross-realm access; only tenant-scoped callers are bound.

## Capabilities

### New Capabilities

- `iam-admin`: Tenant-scoped authorization for the IAM admin route family so that tenant-scoped callers can only operate on the Keycloak realm that corresponds to their own verified tenant ID.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the iam-admin capability spec -->

## Impact

- `services/adapters/src/keycloak-admin.mjs::validateIamAdminRequest:285-323` — add `tenantId` param + `context.realmId === tenantId` assertion for non-platform scope.
- `services/adapters/src/keycloak-admin.mjs::buildIamAdminAdapterCall:489` — pass `tenantId` into `validateIamAdminRequest`.
- Entire `/v1/iam/realms/{realmId}/…` route family is affected for tenant-scoped callers.
- Tenant-scoped callers targeting another tenant's realm now receive 403; same-tenant IAM admin calls and platform-scoped calls are unaffected.
- Black-box suite: new cross-realm rejection test (`bbx-iam-cross-realm-*`).
