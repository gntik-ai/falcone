# tenant-lifecycle — spec delta for fix-metrics-quotas-500

## MODIFIED Requirements

### Requirement: Tenant quota metrics endpoint returns 200

The system SHALL respond to `GET /v1/metrics/tenants/{id}/quotas` with **HTTP 200**
and a JSON body containing the tenant's current quota usage when called by an
authenticated superadmin or tenant owner with appropriate scope.

#### Scenario: Superadmin retrieves tenant quota metrics

- **WHEN** a superadmin calls `GET /v1/metrics/tenants/{id}/quotas`
- **THEN** the response MUST be **200** with a JSON body containing quota data and
  MUST NOT be a 500 error caused by a missing relation or permission error
