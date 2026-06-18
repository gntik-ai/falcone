# mcp — spec delta for add-platform-mcp-http-route

## ADDED Requirements

### Requirement: Expose the platform MCP server over HTTP

The system SHALL ensure that expose the platform MCP server over HTTP: Register an HTTP route for the platform MCP server (tenant-scoped).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An MCP client connects to the platform MCP and manages projects/resources, tenant-scoped
