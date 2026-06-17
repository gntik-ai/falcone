# tenant-rbac — spec delta for fix-platform-client-default-scopes

## MODIFIED Requirements

### Requirement: Platform Keycloak clients include standard default scopes

The system SHALL create the `in-falcone-console` and `in-falcone-gateway` Keycloak
clients with the standard default client scopes `roles`, `basic`, and `profile` so
that tokens issued to those clients carry `realm_access.roles` and standard profile
claims.

#### Scenario: Superadmin token contains realm_access.roles after fresh install

- **WHEN** a superadmin authenticates via `POST /v1/auth/login-sessions` on a fresh
  install
- **THEN** the returned JWT MUST contain `realm_access.roles` with at least
  `["superadmin"]` and the scope string MUST include `roles`

#### Scenario: Role-gated operations succeed with freshly issued superadmin token

- **WHEN** a superadmin uses the freshly issued token to call a superadmin-gated
  endpoint (e.g. `POST /v1/tenants`)
- **THEN** the response MUST be **201** (or the appropriate success code) and MUST NOT
  be **403**

#### Scenario: Non-superadmin token is correctly denied role-gated endpoints

- **WHEN** a token without the `superadmin` role attempts a superadmin-only operation
- **THEN** the response MUST be **403** — the role check MUST remain effective
