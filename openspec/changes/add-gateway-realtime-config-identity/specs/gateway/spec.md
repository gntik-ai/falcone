# gateway — spec delta for add-gateway-realtime-config-identity

## ADDED Requirements

### Requirement: Gateway omits identity-header injection for /v1/realtime/* (CDC captures) and /v1/admin/config/* -> 401

The system SHALL ensure that gateway omits identity-header injection for /v1/realtime/* (CDC captures) and /v1/admin/config/* -> 401: Wire the APISIX identity-injection plugin for `/v1/realtime/*` (captures) and `/v1/admin/config/*`, mirroring the working data-plane routes (relates to the flows/mcp gateway-route gap G3).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** `GET /v1/realtime/workspaces/{ws}/pg-captures` and `/v1/admin/config/*` return business responses for an authorized caller
