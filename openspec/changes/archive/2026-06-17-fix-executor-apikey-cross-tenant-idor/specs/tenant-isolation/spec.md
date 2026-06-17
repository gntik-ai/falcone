# tenant-isolation — spec delta for fix-executor-apikey-cross-tenant-idor

## ADDED Requirements

### Requirement: API-key issuance must be scoped to the caller's tenant

The system SHALL verify, before issuing an API key via
`POST /v1/workspaces/{workspaceId}/api-keys`, that `{workspaceId}` is owned by
the tenant identified in the authenticated caller's JWT (`tenant_id` claim).

When the workspace belongs to a different tenant the system SHALL respond with
**HTTP 403** and the error code `CROSS_TENANT_VIOLATION`; it MUST NOT create or
return a key.

#### Scenario: Cross-tenant api-key issuance is rejected

- **WHEN** a caller whose verified `tenant_id` is `ten_A` sends
  `POST /v1/workspaces/{ws_B}/api-keys` where `ws_B` is owned by `ten_B`
- **THEN** the executor MUST respond **403** with body containing
  `CROSS_TENANT_VIOLATION` and MUST NOT persist any new API key in the store

#### Scenario: Same-tenant api-key issuance succeeds

- **WHEN** a caller whose verified `tenant_id` is `ten_A` sends
  `POST /v1/workspaces/{ws_A}/api-keys` where `ws_A` is owned by `ten_A`
- **THEN** the executor MUST respond **201** with a valid `flc_anon_…` key

#### Scenario: Foreign-tenant key grants no data-plane access

- **WHEN** an API key minted in tenant-A's workspace is presented to the executor
  for a data-plane request targeting tenant-B's workspace
- **THEN** the executor MUST respond **403** and MUST NOT serve tenant-B's data
