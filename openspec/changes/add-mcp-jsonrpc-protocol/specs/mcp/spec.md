# mcp — spec delta for add-mcp-jsonrpc-protocol

## ADDED Requirements

### Requirement: Expose the standard MCP wire protocol (JSON-RPC / Streamable-HTTP)

The system SHALL ensure that expose the standard MCP wire protocol (JSON-RPC / Streamable-HTTP): Expose the MCP protocol surface so a standard MCP client can list+call tools.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A standard MCP client lists and calls a hosted tool over the protocol
