## ADDED Requirements

### Requirement: The control-plane runtime serves the MCP management API
The system SHALL serve the MCP server management API from the live control-plane runtime under `/v1/mcp/workspaces/{workspaceId}/servers`, supporting create, retrieve, list, curate, publish a version, approve a version, invoke a tool, read the audit, and delete — gated on the MCP capability being enabled.

#### Scenario: The full management loop works end to end
- **WHEN** a tenant creates a server, curates it, publishes a version, retrieves it, invokes a tool, and reads the audit through the runtime
- **THEN** each step succeeds and the retrieved server reports its endpoint, active version, and curated tools

#### Scenario: MCP routes are absent when the capability is disabled
- **WHEN** the MCP capability is not enabled
- **THEN** the runtime registers no `/v1/mcp` routes

### Requirement: MCP management is tenant-scoped on the live runtime
The system SHALL derive the tenant and workspace for every MCP management request from the verified credential and SHALL ensure a tenant cannot read, invoke, audit, or list another tenant's server.

#### Scenario: Cross-tenant access is denied
- **WHEN** a tenant requests another tenant's server detail, tool call, or audit
- **THEN** the request is denied as not found and the other tenant's server never appears in the requester's list

### Requirement: MCP quotas and rate limits are enforced on the live runtime
The system SHALL enforce the per-tenant MCP quotas and rate limits on the management API, returning the correct enforcement response on a breach.

#### Scenario: Server-count quota breach is rejected
- **WHEN** creating a server would exceed the tenant's running-server quota under the enforced mode
- **THEN** the request is rejected with a quota-exceeded response identifying the breached dimension

### Requirement: A version bump that changes tool descriptions is held for review on the live runtime
The system SHALL hold a new server version that changes a tool's description or scope for review and SHALL keep serving the previously approved version until the new version is approved.

#### Scenario: Unapproved change is not served, then serves after approval
- **WHEN** a tenant publishes a version that changes a tool description and then approves it
- **THEN** the prior version keeps serving until approval, after which the new version serves
