## ADDED Requirements

### Requirement: Function access MUST be scoped to the caller's tenant

The system SHALL constrain every function lookup by the caller's `tenant_id` and SHALL verify function ownership on the invoke, get, and activations routes, so that a principal cannot invoke or read another tenant's function, inline source, or activation logs.

#### Scenario: Cross-tenant function access by resourceId is rejected

- **WHEN** an authenticated principal of Tenant B invokes, gets, or reads activations for a function `resourceId` owned by Tenant A
- **THEN** the system returns HTTP 404 or 403 and discloses no function source, output, or activation logs

#### Scenario: Own-tenant function access succeeds

- **WHEN** an authenticated principal invokes or reads a function that belongs to its own tenant
- **THEN** the system processes the request and returns the appropriate success status
