# iam — spec delta for fix-keycloak-persistent-store

## ADDED Requirements

### Requirement: Keycloak realm state SHALL be durable across identity-provider restarts

The identity provider (Keycloak) SHALL persist all realm state — the platform realm and every
per-tenant realm, including their clients, roles, users, and credentials — in a relational database
that survives pod restarts, rescheduling, and OOM termination. The deployment SHALL NOT rely on an
in-memory or pod-ephemeral store for realm data, and SHALL size the identity-provider container so it
does not OOM under multi-tenant load.

#### Scenario: Realms survive an identity-provider pod restart

- **WHEN** a platform realm and at least one tenant realm exist and the Keycloak pod is deleted
  (or OOM-killed) and rescheduled
- **THEN** the replacement pod reconnects to the same persistent store, the platform realm and the
  tenant realm (with their clients, roles, and users) are still present and served (OIDC discovery and
  admin reads succeed), and no re-bootstrap is required

#### Scenario: Identity provider does not lose data under multi-tenant load

- **WHEN** multiple tenant realms and users are provisioned and exercised concurrently
- **THEN** the identity-provider container stays within its memory limit (no exit-137 OOM) and no realm
  or user data is lost

#### Scenario: Dedicated persistence database is provisioned automatically

- **WHEN** the platform is installed (or upgraded) with the identity provider enabled
- **THEN** a dedicated logical database for Keycloak is created on the platform's PostgreSQL instance
  before Keycloak starts, owned by the application role Keycloak connects as, and Keycloak initializes
  its schema there — the install converges without manual database setup and without coupling Keycloak's
  schema to the platform application database
