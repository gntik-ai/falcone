# tenant-lifecycle — spec delta for fix-plans-list-500

## MODIFIED Requirements

### Requirement: Plan catalog listing returns 200 for superadmin

The system SHALL respond to `GET /v1/plans` with **HTTP 200** and a JSON array of
available plan definitions when called by an authenticated superadmin.

#### Scenario: Superadmin retrieves plan catalog

- **WHEN** a superadmin calls `GET /v1/plans`
- **THEN** the response MUST be **200** with a JSON body containing the array of plans
  and MUST NOT be a 500 error
