# tenant-lifecycle — spec delta for fix-metrics-quotas-500

## ADDED Requirements

### Requirement: Tenant quota metrics endpoint returns 200

The control-plane runtime SHALL provision the quota catalog/override schema
(`quota_dimension_catalog`, `quota_overrides`, `plans.quota_type_config`) so that the
tenant-effective-entitlements query resolves, and the console metrics quota handler SHALL
degrade to an empty (healthy) posture on any underlying error so that
`GET /v1/metrics/tenants/{id}/quotas` responds with **HTTP 200** for an authorized caller
and MUST NOT return a 500 caused by a missing relation (42P01) or a forbidden inner lookup.

#### Scenario: Authorized caller retrieves tenant quota metrics

- **WHEN** a superadmin or the tenant's authorized user calls `GET /v1/metrics/tenants/{id}/quotas`
- **THEN** the response MUST be **200** with a quota posture body (dimensions + breaches), and
  MUST NOT be a 500 error caused by a missing relation or a forbidden inner lookup

#### Scenario: Quota source unavailable degrades to a healthy posture

- **WHEN** the entitlements limits source errors (missing relation, or the inner action forbids the
  authorized caller's role)
- **THEN** the endpoint MUST still return **200** with an empty dimension set and no hard-limit
  breaches, rather than a 500
