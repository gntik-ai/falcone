## ADDED Requirements

### Requirement: IAM admin requests are bound to the caller's tenant realm

The system SHALL assert that `context.realmId` equals the authenticated caller's `tenantId` for every non-platform-scoped IAM admin request, leveraging the established convention that `realm = tenantId` (`services/provisioning-orchestrator/src/collectors/iam-collector.mjs:70`). The assertion MUST occur inside `validateIamAdminRequest` (`services/adapters/src/keycloak-admin.mjs:285-323`) after `tenantId` is passed in from `buildIamAdminAdapterCall` (`services/adapters/src/keycloak-admin.mjs:489`). When the assertion fails, the system MUST return HTTP 403 before constructing or issuing any Keycloak admin call.

#### Scenario: Tenant-scoped caller cannot operate on another tenant's realm

- **WHEN** a caller whose verified tenant is `A` issues an IAM admin request (e.g. `DELETE /v1/iam/realms/{realmId_of_B}/users/{userId}`) targeting a `realmId` that equals tenant `B`'s ID
- **THEN** the system returns HTTP 403 before any Keycloak admin call is constructed or sent
- **AND** tenant `B`'s Keycloak realm is unmodified

#### Scenario: Same-tenant IAM admin request is permitted

- **WHEN** a caller whose verified tenant is `A` issues an IAM admin request targeting a `realmId` that equals tenant `A`'s ID
- **THEN** the system passes validation and proceeds to construct and issue the Keycloak admin call

### Requirement: Platform-scoped callers retain unrestricted realm access

The system SHALL exempt callers whose `context.scope` is `'platform'` from the `context.realmId === tenantId` assertion, allowing platform-scoped operators to administer any tenant's Keycloak realm.

#### Scenario: Platform-scoped caller operates on any tenant's realm

- **WHEN** a caller holding a platform-scoped role issues an IAM admin request targeting a `realmId` belonging to any tenant
- **THEN** the system does not apply the `realmId === tenantId` check
- **AND** the Keycloak admin call is constructed and issued normally

### Requirement: tenantId is propagated into realm validation without exception

The system SHALL ensure that `tenantId` is passed from `buildIamAdminAdapterCall` into `validateIamAdminRequest` for every IAM admin request, so that no code path in the route family can reach Keycloak adapter logic without having been subject to the realm-binding assertion.

#### Scenario: Missing tenantId propagation is eliminated

- **WHEN** any IAM admin route in the `/v1/iam/realms/{realmId}/…` family is invoked
- **THEN** `buildIamAdminAdapterCall` passes `tenantId` to `validateIamAdminRequest` before any adapter call is made
- **AND** `validateIamAdminRequest` performs the `realmId === tenantId` check for non-platform scope
