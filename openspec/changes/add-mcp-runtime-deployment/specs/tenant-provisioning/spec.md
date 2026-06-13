## ADDED Requirements

### Requirement: Provisioning saga includes an MCP runtime domain
The provisioning saga SHALL include an MCP domain applier that stands up the tenant's MCP runtime footprint as part of tenant provisioning and removes it on deprovisioning, with rollback on failure, consistent with the other per-domain appliers (IAM, Kafka, Postgres, MongoDB, storage, functions).

#### Scenario: MCP domain applied during provisioning
- **WHEN** a tenant is provisioned with MCP hosting enabled
- **THEN** the saga's MCP applier creates the tenant's MCP runtime footprint and records it in the provisioning result

#### Scenario: MCP domain rolled back on failure
- **WHEN** provisioning fails after the MCP domain has been applied
- **THEN** the saga rolls back the MCP footprint, leaving no orphaned MCP runtime resources for the tenant
