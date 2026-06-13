## ADDED Requirements

### Requirement: Each MCP tool call produces an attributed log line and latency metric
The system SHALL produce, for each MCP tool call, a usage metric and a latency observation and a structured log line attributed to the tenant, workspace, server, tool, and OAuth client, using only bounded labels (no personally-identifying or high-cardinality labels).

#### Scenario: A tool call is attributed across tenant, server, tool and OAuth client
- **WHEN** an MCP tool call completes
- **THEN** a usage metric, a latency observation, and a log line are produced carrying the tenant, server, tool, and OAuth-client attribution

#### Scenario: Telemetry carries no forbidden label
- **WHEN** MCP tool-call telemetry is produced
- **THEN** it contains none of the forbidden personally-identifying or high-cardinality labels

### Requirement: Per-OAuth-client MCP audit trail is tenant-scoped and queryable
The system SHALL record MCP governance events (OAuth client and server lifecycle) as audit events in the `mcp` audit subsystem with actor, scope envelope, resource, action, and result, and SHALL expose them through a tenant-scoped audit query so that one tenant cannot read another tenant's MCP audit records.

#### Scenario: An OAuth-client event is recorded for the mcp subsystem
- **WHEN** an MCP OAuth-client lifecycle action occurs
- **THEN** an audit event is recorded in the `mcp` subsystem with the OAuth client as actor and the tenant in the scope envelope

#### Scenario: A cross-tenant audit probe returns nothing
- **WHEN** a tenant queries MCP audit records with another tenant's identifier in the request
- **THEN** the query is scoped to the requesting tenant and no other tenant's records are returned

### Requirement: MCP metrics and audit conform to the observability contracts
The system SHALL define the MCP usage metric family and the `mcp` audit subsystem within the platform observability and audit contracts, and these definitions SHALL satisfy the observability validators.

#### Scenario: MCP observability contracts validate
- **WHEN** the observability and audit contract validators run
- **THEN** the MCP metric family and audit subsystem are present and the validators pass
