# iam — spec delta for add-tenant-owner-enduser-management

## ADDED Requirements

### Requirement: Tenant owners can manage their own realm's app end-users

A tenant owner/admin SHALL be able to list (and, per #567, disable and delete) the app
end-users of the realm owned by its own tenant. The handler SHALL authorize superadmin
OR the owner/admin of the tenant that owns the realm, and SHALL deny any cross-tenant
access (an owner of a different tenant → 403).

#### Scenario: an owner lists its own realm's end-users

- **WHEN** a tenant_owner calls `GET /v1/iam/realms/{realmId}/users` for the realm owned
  by its tenant
- **THEN** the request succeeds (200) and returns that realm's end-users.

#### Scenario: cross-tenant listing is denied

- **WHEN** a tenant_owner of tenant A calls `GET /v1/iam/realms/{realmId}/users` for a
  realm owned by tenant B
- **THEN** the request is rejected with 403 and no Keycloak call is made.
