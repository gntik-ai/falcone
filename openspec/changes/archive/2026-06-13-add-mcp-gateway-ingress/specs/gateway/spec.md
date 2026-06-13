## ADDED Requirements

### Requirement: Gateway exposes an MCP inbound route
The gateway SHALL define an MCP inbound route (an APISIX route declaration, consistent with how other non-control-plane surfaces are declared — e.g. `routes/backup-admin-routes.yaml`) that terminates Streamable HTTP, applies OAuth 2.1 token validation and scope enforcement (reusing the platform `keycloak-openid-connect` + `scope-enforcement` plugins), and proxies to tenant MCP-server workloads — without disrupting the existing gateway-policy family contracts.

#### Scenario: MCP route does not break gateway-policy contracts
- **WHEN** the gateway policy contracts are validated
- **THEN** the MCP inbound route is present and the existing gateway-policy family/route consistency checks still pass with no violations

#### Scenario: MCP route uses OAuth + scope enforcement and SSE-friendly upstream
- **WHEN** the MCP route handles a request
- **THEN** it validates the OAuth 2.1 token and enforces the MCP scope before proxying, over a Streamable-HTTP-friendly upstream (long read timeout, response buffering disabled)
