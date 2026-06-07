## ADDED Requirements

### Requirement: Consumer-status action binds secretPath to the caller's tenant before returning data

The system SHALL resolve the owning tenant of the supplied `secretPath` server-side from `getActiveVersion` before invoking `listConsumers` or `listPendingPropagations`. For tenant-scoped callers, the system SHALL assert that `activeVersion.tenant_id` equals `auth.tenantId`; if the assertion fails or no active version exists, the system MUST return 403/404 without disclosing any consumer or propagation data.

#### Scenario: Tenant-scoped caller cannot read another tenant's consumer status

- **WHEN** a caller whose verified `auth.tenantId` is `A` requests consumer status for a `secretPath` whose recorded `activeVersion.tenant_id` is `B`
- **THEN** the system returns 403/404 before calling `listConsumers` or `listPendingPropagations`
- **AND** no consumer registry or propagation data for tenant `B` is included in the response

#### Scenario: Tenant-scoped caller can read their own tenant's consumer status

- **WHEN** a caller whose verified `auth.tenantId` is `A` requests consumer status for a `secretPath` whose recorded `activeVersion.tenant_id` is `A`
- **THEN** the system returns the consumer registry and propagation state for that `secretPath`

#### Scenario: No active version results in 403/404 for tenant-scoped caller

- **WHEN** a tenant-scoped caller supplies a `secretPath` for which no active version record exists in `secret_version_states`
- **THEN** the system returns 403/404 without calling `listConsumers` or `listPendingPropagations`

### Requirement: Platform-scoped callers retain cross-tenant consumer-status access

The system SHALL exempt callers holding a platform-scoped role (e.g. `superadmin`, `platform-operator`) from the tenant-ownership assertion, allowing them to query consumer status for any `secretPath` regardless of the owning tenant.

#### Scenario: Platform-scoped caller reads any tenant's consumer status

- **WHEN** a caller holding a platform-scoped role requests consumer status for a `secretPath` owned by any tenant
- **THEN** the system returns the consumer registry and propagation state without a 403/404

### Requirement: Ownership assertion precedes all data-returning repository calls

The system SHALL call `getActiveVersion` and complete the ownership assertion before invoking `listConsumers` or `listPendingPropagations`, so that a failed assertion always produces an early exit with no side-readable data. The system MUST NOT reorder or defer the ownership check.

#### Scenario: listConsumers is not called when ownership assertion fails

- **WHEN** a tenant-scoped caller supplies a `secretPath` belonging to a different tenant
- **THEN** `listConsumers` is never invoked during that request
- **AND** `listPendingPropagations` is never invoked during that request
