## 1. mcp-oauth helpers (pure, unit-tested)

- [x] 1.1 `deriveToolScopes(serverId, tools)` → Keycloak client-scope definitions (`mcp:<server>:<tool>`, `include.in.token.scope`, consent text from the tool description)
- [x] 1.2 `buildMcpClientRegistration({ clientId, redirectUris, toolScopes, planLimits })` → curated client-registration request reusing the HTTPS redirect-URI validation; returns violations for non-HTTPS redirects / over-limit
- [x] 1.3 Unit tests for scope derivation, HTTPS redirect rejection, and tenant/plan limits

## 2. Control-plane management surface

- [ ] 2.1 Routes to register/list/revoke MCP OAuth clients and assign per-tool scopes, built on `external-application-iam.mjs` + the `keycloak-admin.mjs` adapter (client/scope/credential primitives)
- [ ] 2.2 Consent capture/record reusing the `wf-con-001-user-approval` approval-flow pattern
- [ ] 2.3 Token lifecycle (issue/refresh/revoke) via the existing credential rotation/revoke primitives; never expose raw Keycloak admin to tenants

## 3. Verify

- [x] 3.1 Live spike on `test-cluster-b` Keycloak: per-tool client scope + registered client → `client_credentials` token carries the per-tool scope; throwaway realm cleaned up (`spikes/add-mcp-oauth-authorization-server/evidence/oauth-flow.txt`)
- [ ] 3.2 Contract/unit tests for the management routes (scope assignment, revocation, consent)
- [ ] 3.3 End-to-end with the gateway (#389): a token missing the per-tool scope is rejected at the gateway (403)

## 4. Finalize

- [ ] 4.1 `openspec validate add-mcp-oauth-authorization-server --strict`
- [ ] 4.2 Confirm no raw Keycloak admin/DCR endpoint is reachable by tenants; HTTPS-only redirect URIs enforced
