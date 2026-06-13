# add-mcp-oauth-authorization-server — throwaway spike (issue #390)

EPHEMERAL. Not production code. `oauth-flow.mjs` proves, against the live test-cluster-b Keycloak,
that a per-tool scope (Keycloak client scope) is carried in a token issued to a registered MCP
client — validating "extend Keycloak as the OAuth 2.1 AS" (ADR-12). Uses an isolated throwaway
realm and deletes it. Evidence in `evidence/oauth-flow.txt`.
