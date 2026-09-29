## ADDED Requirements

### Requirement: Tenant scoped console authentication

The console authentication API SHALL accept an optional `tenantId` on login, refresh, and logout. When present, it SHALL resolve an active tenant by ID from the tenants store and use that row's `iam_realm` and `${slug}-app` public client. It SHALL URL encode the realm in Keycloak endpoint paths. Missing, unknown, inactive, or unprovisioned tenants SHALL produce no Keycloak request and SHALL issue no token. Login with an unknown tenant SHALL use the same invalid credentials response as a bad login.

#### Scenario: Tenant user signs in

Given a signup user in an active tenant realm, when the user logs in with that tenant ID and valid credentials, then the API returns a session for that user with the tenant claim.

#### Scenario: Platform user signs in

When a login request omits tenant ID, then the API uses `CONSOLE_AUTH_REALM` and `CONSOLE_AUTH_CLIENT_ID` defaults as before.

#### Scenario: Tenant session ends

When a tenant session refreshes or logs out with its tenant ID, then the API targets that tenant realm and client. A revoked refresh token is rejected.

### Requirement: Console retains auth tenant context

The console SHALL send a tenant ID from the login URL, retain it in the local session, and send it on refresh and logout. The signup success link SHALL carry the signup tenant ID to login.
