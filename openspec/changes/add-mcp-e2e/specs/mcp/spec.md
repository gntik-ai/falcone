## ADDED Requirements

### Requirement: MCP has a real-stack E2E suite following the repo conventions
The system SHALL provide Playwright E2E specs for the MCP capability that deploy into an ephemeral namespace on the kind cluster and are always torn down, covering the full loop, cross-tenant isolation, and version-pinning, with a per-issue runner entry.

#### Scenario: The MCP E2E suite is runnable and tears down
- **WHEN** the MCP E2E suite is run via the standard runner
- **THEN** the stack is deployed into an ephemeral namespace and the namespace is always removed afterward

#### Scenario: Full loop, cross-tenant, and version-pinning are covered
- **WHEN** the MCP E2E specs are listed
- **THEN** they include the full loop (create → curate → deploy → connect → call → observe), cross-tenant isolation probes, and a version-pinning review check

### Requirement: MCP E2E specs gate honestly on the live management API
The system SHALL probe whether the control-plane serves the MCP management API and, when it is not served, SHALL skip the dependent specs with a precise reason rather than failing or reporting a false pass.

#### Scenario: Specs skip with a reason when the management API is absent
- **WHEN** the MCP E2E specs run against a control-plane that does not serve the MCP management API
- **THEN** the specs are skipped with a reason naming the missing capability, and none fail

#### Scenario: Cross-tenant probes deny tenant B against tenant A
- **WHEN** the management API is served and tenant B probes tenant A's server, tools, or audit
- **THEN** each probe is denied or empty, proving isolation
