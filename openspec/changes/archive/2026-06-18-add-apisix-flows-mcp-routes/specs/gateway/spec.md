# gateway — spec delta for add-apisix-flows-mcp-routes

## ADDED Requirements

### Requirement: Gateway exposes no /v1/flows or /v1/mcp routes

The system SHALL ensure that gateway exposes no /v1/flows or /v1/mcp routes is corrected: Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes (standalone APISIX config + gateway-config).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** `GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` → 200 via the gateway
