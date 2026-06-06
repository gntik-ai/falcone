## ADDED Requirements

### Requirement: SDK package status endpoint requires authentication and tenant scoping

The system SHALL require a valid tenant identity (from `x-auth-tenant-id` or `x-tenant-id` header) on every request to the SDK package status endpoint. The system SHALL return HTTP 401 when no tenant identity is present. The system SHALL pass the authenticated `tenantId` as a predicate to all data-layer queries so that only the requesting tenant's SDK package records are returned.

#### Scenario: Unauthenticated status request is rejected

- **WHEN** a caller sends a GET request to the SDK status endpoint without a tenant identity header
- **THEN** the system returns HTTP 401 and does not return any SDK package data

#### Scenario: Authenticated caller receives only their tenant's status

- **WHEN** a caller authenticated as tenant A sends a GET request to the SDK status endpoint for a `workspaceId` owned by tenant A
- **THEN** the system returns HTTP 200 with the SDK package status for tenant A's workspace

#### Scenario: Authenticated caller cannot read another tenant's SDK status

- **WHEN** a caller authenticated as tenant A sends a GET request to the SDK status endpoint with a `workspaceId` that belongs to tenant B
- **THEN** the system returns HTTP 403 or HTTP 404 and does not reveal tenant B's `downloadUrl`, `status`, or `specVersion`

### Requirement: SDK generate endpoint binds spec access to the authenticated tenant

The system SHALL compare `spec.tenantId` to the authenticated `tenantId` after fetching a spec in the generate handler, and SHALL return HTTP 403 when they do not match. The system SHALL NOT read `spec.formatJson` from a spec owned by a different tenant, nor write SDK package rows associating the authenticated tenant with another tenant's workspace.

#### Scenario: Cross-tenant spec read is rejected during generate

- **WHEN** a caller authenticated as tenant A calls the SDK generate endpoint targeting a `workspaceId` whose spec is owned by tenant B
- **THEN** the system returns HTTP 403 before reading `spec.formatJson` or inserting any SDK package row
- **AND** no row associating tenant A with tenant B's `workspaceId` is written to the `sdk_packages` table

#### Scenario: Same-tenant generate succeeds

- **WHEN** a caller authenticated as tenant A calls the SDK generate endpoint targeting a `workspaceId` whose spec is owned by tenant A
- **THEN** the system proceeds with SDK generation and writes a `sdk_packages` row for tenant A

### Requirement: All data-layer queries for SDK packages and specs are predicated on tenant_id

The system SHALL include `AND tenant_id = $N` in every SELECT and UPDATE statement in `sdk-package-repo.mjs` and `spec-version-repo.mjs` that reads or mutates SDK or spec records. The system SHALL NOT return or modify rows belonging to a tenant other than the one supplied to the query.

#### Scenario: getSdkPackage returns no rows for a mismatched tenant

- **WHEN** `getSdkPackage` is called with a `workspaceId` that exists for tenant B and a `tenantId` of tenant A
- **THEN** the function returns no record (empty or null result) without error

#### Scenario: markStaleSdkPackages only affects the owning tenant's rows

- **WHEN** `markStaleSdkPackages` is called for a `workspaceId` owned by tenant A
- **THEN** only rows with `tenant_id = tenant A` are updated; tenant B's rows for overlapping `workspaceId` values are unchanged
