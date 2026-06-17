# tenant-rbac — spec delta for fix-tenant-realm-token-issuance

## ADDED Requirements

### Requirement: Tenant realm is provisioned with a client and tenant_id mapper at tenant creation

The system SHALL, as part of the tenant creation flow, provision in the tenant's
Keycloak realm:
- A client (e.g. `<tenant-slug>-app`) that end-users can authenticate against.
- A `tenant_id` protocol mapper that embeds the tenant's ID into every token issued
  by that realm.

#### Scenario: Tenant-realm token contains tenant_id claim

- **WHEN** a tenant user authenticates against the tenant realm
- **THEN** the issued JWT MUST contain a `tenant_id` claim equal to the owning
  tenant's ID

### Requirement: Executor accepts tokens from tenant-realm issuers

The system SHALL accept JWTs issued by a tenant realm's JWKS endpoint in addition to
the platform realm JWKS, so that tenant users can reach the data-plane and issue API
keys using their tenant-realm token.

The executor MUST validate the `tenant_id` claim from the token and MUST NOT accept
a tenant-A token as authorization for tenant-B resources.

#### Scenario: Tenant owner token is accepted by the executor

- **WHEN** a tenant owner presents a JWT issued by their tenant realm (with a valid
  `tenant_id` claim)
- **THEN** the executor MUST authenticate the request and authorize operations scoped
  to that tenant

#### Scenario: Tenant-A token is denied access to tenant-B resources

- **WHEN** a token issued by tenant-A's realm (with `tenant_id = ten_A`) is used to
  access a resource belonging to `ten_B`
- **THEN** the executor MUST respond **403** and MUST NOT expose tenant-B data
