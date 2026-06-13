## ADDED Requirements

### Requirement: Tenant purge cascades to the MCP domain
The tenant purge sweep SHALL include an MCP domain teardown that removes the tenant's MCP runtime footprint — its hosted MCP-server workloads and its MCP metadata — with the same partial-failure semantics as the other purge domains (IAM, Postgres, Mongo, Kafka, storage, functions, workflows): if the MCP teardown reports any error, the sweep MUST NOT finalize the purge.

#### Scenario: MCP teardown removes the tenant's MCP footprint
- **WHEN** a tenant is purged
- **THEN** the sweep's MCP teardown deletes the tenant's MCP-server workloads and MCP metadata rows, tenant-scoped

#### Scenario: MCP teardown failure blocks purge finalization
- **WHEN** the MCP teardown reports an error during a purge
- **THEN** the sweep does not finalize the purge and surfaces a partial failure for the tenant

#### Scenario: MCP teardown is idempotent
- **WHEN** the MCP teardown runs again for a tenant whose MCP resources are already gone (or were never provisioned)
- **THEN** it removes nothing and returns without error
