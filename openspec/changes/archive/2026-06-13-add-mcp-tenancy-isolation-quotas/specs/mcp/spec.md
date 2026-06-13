## ADDED Requirements

### Requirement: A hosted MCP server is isolated to its tenant
The system SHALL host each MCP server as an internal-only workload reachable only through the gateway, with egress constrained so it cannot reach another tenant's services, and SHALL ensure a cross-tenant probe of the server endpoint, its tools, its logs, or its OAuth credentials does not succeed.

#### Scenario: Cross-tenant probe is denied
- **WHEN** a caller in one tenant attempts to reach another tenant's MCP server endpoint, tools, logs, or OAuth credentials
- **THEN** the attempt does not succeed

#### Scenario: Server egress cannot reach another tenant
- **WHEN** an MCP server pod attempts to connect to another tenant's namespace or services
- **THEN** the network policy constrains egress to DNS and the platform namespace, so the connection is not permitted (under a policy-enforcing CNI)

### Requirement: Per-tenant MCP quotas and rate limits are enforced and audited
The system SHALL enforce per-tenant quotas on running servers and on tools per server, and rate limits on tool calls per minute per server and per OAuth client, honoring an enforcement mode (enforced or unbounded); a breach SHALL return the correct enforcement response and be recorded as an audit event, and rate-limit accounting SHALL be scoped per tenant so one tenant's traffic never consumes another's budget.

#### Scenario: Quota breach returns the enforcement response and is audited
- **WHEN** a tenant exceeds its running-server or per-server tool quota under the enforced mode
- **THEN** the operation is rejected with a quota-exceeded response and an audit event is recorded

#### Scenario: Rate-limit breach is per-server and per-OAuth-client
- **WHEN** tool calls for a server or an OAuth client exceed the per-minute rate limit under the enforced mode
- **THEN** the call is rejected with a rate-limited response carrying a retry hint and an audit event is recorded

#### Scenario: Rate budgets do not cross tenants
- **WHEN** two tenants use the same server or OAuth client identifier
- **THEN** their rate-limit budgets are independent and one tenant's traffic does not consume or reveal the other's

### Requirement: Idle MCP servers scale to zero
The system SHALL scale an idle MCP server to zero replicas and cold-start it on demand, so an unused server incurs no running cost.

#### Scenario: Idle server scales to zero and resumes on demand
- **WHEN** an MCP server is idle
- **THEN** it scales to zero replicas and cold-starts on the next request
