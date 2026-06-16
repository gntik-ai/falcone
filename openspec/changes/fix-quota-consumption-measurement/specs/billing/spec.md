## ADDED Requirements

### Requirement: Plan consumption MUST be measured from real resource counts

The system SHALL compute each plan-consumption dimension from the tenant's actual resource counts and return them on `GET /v1/tenants/{t}/plan/consumption` and the usage metrics endpoints, rather than returning `currentUsage:null`/`measuredValue:0` with `NO_QUERY_MAPPING`/`CONSUMPTION_QUERY_FAILED`.

#### Scenario: Consumption reflects real usage

- **WHEN** a tenant has provisioned measurable resources and queries `GET /v1/tenants/{t}/plan/consumption`
- **THEN** the relevant dimension reports a non-zero `currentUsage` matching the real resource count

### Requirement: Quota limits MUST enforce against measured consumption

The system SHALL enforce soft and hard plan limits using the measured consumption so that usage-based quota enforcement fires.

#### Scenario: Hard limit is enforced

- **WHEN** a tenant's measured consumption for a dimension exceeds its hard limit
- **THEN** the system enforces the limit (rejects further consumption of that dimension)
