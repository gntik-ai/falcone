# iam — spec delta for fix-iam-route-wiring

## ADDED Requirements

### Requirement: Wire the catalogued IAM routes (getIamUser / role-by-name / realm CRUD)

The catalogued IAM routes SHALL resolve to a handler in the runtime instead of returning 404
NO_ROUTE:

- `GET /v1/iam/realms/{realmId}/users/{userId}` returns a single user (owner-of-realm or superadmin).
- `GET` and `DELETE /v1/iam/realms/{realmId}/roles/{roleName}` read and remove a realm role (superadmin).
- `GET /v1/iam/realms` lists every tenant realm (superadmin only).
- `GET` and `PUT /v1/iam/realms/{realmId}` read and update a realm's login options (owner-of-realm or superadmin).

Cross-tenant access through the realm-scoped routes SHALL be denied (403); a missing user/role SHALL return 404.

#### Scenario: catalogued single-entity reads resolve

- **WHEN** an authorized caller requests `GET /v1/iam/realms/{realmId}/users/{userId}` or `.../roles/{roleName}`
- **THEN** the handler returns the entity (200) or 404 when it does not exist — never 404 NO_ROUTE

#### Scenario: realm CRUD resolves

- **WHEN** a superadmin requests `GET /v1/iam/realms`, or an owner/superadmin requests `GET`/`PUT /v1/iam/realms/{realmId}`
- **THEN** the realm list / realm record (with login options) is returned, and a cross-tenant owner is denied (403)
