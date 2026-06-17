# tenant-lifecycle — spec delta for fix-console-create-tenant-plan

## ADDED Requirements

### Requirement: Tenant creation tolerates an unresolvable plan (best-effort assignment)

`POST /v1/tenants` SHALL create the tenant even when an accompanying `planId` cannot be assigned.
The system SHALL resolve `planId` as a slug or a UUID; when it resolves to a catalog plan the plan
SHALL be assigned, and when it does not (unknown slug, empty catalog, invalid id, or an assignment
error) the tenant SHALL still be created and the response SHALL report the plan assignment outcome
rather than failing the request. A non-UUID plan identifier MUST NOT cause a 502.

#### Scenario: Creating a tenant with a plan slug that has no catalog match still succeeds

- **WHEN** `POST /v1/tenants` is called with a `planId` that is a slug with no matching plan
  (e.g. `"starter"` on an empty catalog)
- **THEN** the response MUST be **201** with the created tenant and
  `planAssignment.assigned == false` (carrying a reason), and MUST NOT be a 502
  `CREATE_TENANT_FAILED` / `invalid input syntax for type uuid`

#### Scenario: Creating a tenant with a resolvable plan assigns it

- **WHEN** `POST /v1/tenants` is called with a `planId` that resolves to a catalog plan (by slug or
  UUID)
- **THEN** the response MUST be **201** and `planAssignment.assigned == true`

#### Scenario: Creating a tenant without a plan succeeds

- **WHEN** `POST /v1/tenants` is called with no `planId`
- **THEN** the response MUST be **201** and no plan is assigned
