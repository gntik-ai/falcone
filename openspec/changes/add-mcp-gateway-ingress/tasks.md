## 1. MCP inbound route (APISIX)

- [x] 1.1 Add `services/gateway-config/routes/mcp-routes.yaml`: an MCP inbound route with `keycloak-openid-connect` (OAuth 2.1) + `scope-enforcement` (`mcp:invoke` scope + per-tenant rate floor), Streamable-HTTP-friendly upstream (long read timeout, `proxy-buffering` disabled)
- [x] 1.2 Route proxies to the internal MCP router upstream which dispatches by `{workspaceId}/{serverId}` to the tenant's ksvc (cross-tenant routing resolved downstream; gateway carries the verified tenant via propagated headers)

## 2. Route declaration (NOT a gateway-policy family)

- [x] 2.1 The MCP inbound is a `routes/*.yaml` APISIX route (like `backup-admin-routes.yaml` / the flows surface), **not** a control-plane product-API *family* — so no entries are needed in `values.yaml gatewayPolicy` / `base/public-api-routing.yaml` families / the internal-contracts route catalog
- [x] 2.2 `pnpm validate:gateway-policy` + `pnpm validate:repo` pass (the family contracts are unaffected by adding the route)

## 3. Verify

- [x] 3.1 Gateway-config contract tests pass (`services/gateway-config/tests`)
- [ ] 3.2 On `test-cluster-b`: a Streamable-HTTP request with a valid token routes through APISIX to a hosted MCP-server ksvc; missing/invalid token → 401; wrong per-tool scope → 403
- [ ] 3.3 Cross-tenant routing probe: tenant A token cannot reach tenant B's server

## 4. Finalize

- [x] 4.1 `openspec validate add-mcp-gateway-ingress --strict`
- [ ] 4.2 Confirm additive (no change to existing route families) and that the runtime stays internal-only (gateway is the sole ingress)
