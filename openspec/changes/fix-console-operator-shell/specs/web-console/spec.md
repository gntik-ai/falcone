# web-console — spec delta for fix-console-operator-shell

## ADDED Requirements

### Requirement: Console session whoami endpoint exists and operator pages are role-correct

The console session endpoint `GET /v1/console/session` SHALL be implemented as an
authenticated whoami that returns the verified principal, so the web-console reconnect
sync and shell no longer hit a dead 404. Operator-facing plan pages SHALL use
operator-authorized (own-scope) routes, and superadmin-only pages SHALL be role-gated.

#### Scenario: the console session endpoint resolves for an authenticated principal

- **WHEN** an authenticated operator's console calls `GET /v1/console/session`
- **THEN** it returns 200 with the verified principal (no 404) and never echoes a
  body/header-supplied identity.

#### Scenario: the my-plan page uses the operator route

- **WHEN** a tenant operator opens `/console/my-plan`
- **THEN** the page reads `/v1/tenant/plan/effective-entitlements` (operator-authorized),
  not the superadmin `/v1/tenants/{id}/plan`; the superadmin plans/tenants pages remain
  role-gated.
