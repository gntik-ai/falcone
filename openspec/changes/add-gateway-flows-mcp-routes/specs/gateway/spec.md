# gateway — spec delta for add-gateway-flows-mcp-routes

## ADDED Requirements

### Requirement: Gateway routes for flows + MCP

The system SHALL ensure that gateway routes for flows + MCP: Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** `/v1/flows/...` and `/v1/mcp/...` -> 200 via the gateway
