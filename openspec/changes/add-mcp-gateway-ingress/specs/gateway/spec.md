## ADDED Requirements

### Requirement: Gateway exposes an MCP inbound route family
The gateway SHALL define an MCP route family that terminates Streamable HTTP, applies OAuth 2.1 token validation and per-tool scope enforcement (reusing the platform scope-enforcement plugin), and proxies to tenant MCP-server workloads — declared consistently across the gateway-policy framework (APISIX routes, public API routing families with qos profiles, and the public route catalog).

#### Scenario: MCP family is declared consistently
- **WHEN** the gateway policy contracts are validated
- **THEN** the MCP route family is present in the APISIX route declarations, the public API routing families, and the public route catalog, with no consistency violations

#### Scenario: MCP family uses OAuth + scope enforcement
- **WHEN** the MCP route handles a request
- **THEN** it applies OAuth 2.1 validation and per-tool scope enforcement before proxying upstream
