# mcp — spec delta for add-mcp-workflow-and-platform-binding

## ADDED Requirements

### Requirement: MCP->workflow mapping orphaned; platform MCP non-functional

The system SHALL ensure that mCP->workflow mapping orphaned; platform MCP non-functional is corrected: Wire the flow-backed tool generator into the MCP engine; make the platform MCP tools call the control-plane.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An MCP tool starts a workflow and returns its result
