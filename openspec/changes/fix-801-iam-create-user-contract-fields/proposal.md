# Change: fix-801-iam-create-user-contract-fields

## Why

Issue #801 is a confirmed IAM contract drift. The public contract documents
`IamUserCreateRequest.attributes`, `realmRoles`, and `bootstrapCredentials`, but
the kind control-plane create-user handler read legacy `roles` and `credentials`
fields and never forwarded attributes to Keycloak.

That means a superadmin can receive `201 Created` for a user creation request
that should provision a tenant-scoped console user, while the created user has no
`tenant_id` attribute and therefore cannot log in as a tenant-scoped principal.

## What Changes

- `deploy/kind/control-plane/b-handlers.mjs`
  - Honors documented `realmRoles`, `bootstrapCredentials.temporaryPassword`,
    `bootstrapCredentials.requiredActions`, `requiredActions`, `enabled`,
    `emailVerified`, and `attributes` for `iamCreateUser`.
  - Keeps legacy `roles`, `credentials`, and flat `password` compatibility.
  - Uses the same `ctx.kcAdmin ?? kcAdmin` dependency seam as neighboring IAM
    handlers so regression tests drive the real handler safely.
  - Rejects documented fields the runtime cannot yet perform (`groups`,
    `metadata`, `bootstrapCredentials.sendEmail`) instead of returning `201`
    while silently dropping them.
- `deploy/kind/control-plane/kc-admin.mjs`
  - Preserves multi-valued IAM attributes from the OpenAPI shape when building
    the Keycloak user representation, while still accepting scalar legacy values.
  - Passes `enabled`, `emailVerified`, and `requiredActions` to Keycloak.
- `tests/unit/iam-create-user-contract-fields.test.mjs`
  - Adds regression coverage for the issue's WHEN/THEN scenario with the real
    handler and an injected Keycloak admin client.
- `tests/blackbox/iam-user-credentials.test.mjs`
  - Extends the credential helper coverage to the documented
    `bootstrapCredentials.temporaryPassword` field.
- `docs/reference/architecture/iam-create-user-contract-fields.md`
  - Documents the handler/contract mapping and unsupported-field behavior.

## Scope

This is a backend/runtime contract-conformance fix for the existing
`POST /v1/iam/realms/{realmId}/users` route. It does not change the OpenAPI
schema, route catalog, SDK surface, or web-console UI.

Group assignment and bootstrap email delivery remain out of this fix's scope.
The handler now fails those requested fields explicitly until the corresponding
runtime operations exist.

## Capabilities

### Modified Capabilities

- `iam-admin`: create-user applies the documented user attributes, realm roles,
  and bootstrap credential fields needed to provision a tenant-scoped console
  user, rather than silently accepting and dropping them.
