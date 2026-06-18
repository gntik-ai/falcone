# mcp — spec delta for fix-mcp-tool-call-execution

## ADDED Requirements

### Requirement: MCP tool-calls return the executor index instead of executing

The system SHALL ensure that mCP tool-calls return the executor index instead of executing is corrected: Set `MCP_SELF_BASE_URL`, fix the instant tool request templates, and route official/platform tools to the control-plane.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A hosted tool-call performs the real action and returns its result
