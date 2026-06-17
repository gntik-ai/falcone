## ADDED Requirements

### Requirement: Console tenant creation MUST target an existing route

The system SHALL have the console "new tenant" wizard submit to the real `POST /v1/tenants` control-plane route rather than the non-existent `/v1/admin/tenants`, so UI-driven tenant creation succeeds.

#### Scenario: Creating a tenant from the console succeeds

- **WHEN** an operator completes the console "new tenant" wizard
- **THEN** the console submits to `POST /v1/tenants` and the tenant is created (no `404 NO_ROUTE`)
