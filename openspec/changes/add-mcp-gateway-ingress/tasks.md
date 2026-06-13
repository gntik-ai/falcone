## 1. MCP inbound route (APISIX)

- [ ] 1.1 Add `services/gateway-config/routes/mcp-routes.yaml`: an MCP inbound route with `keycloak-openid-connect` (OAuth 2.1) + `scope-enforcement` (per-tool `required_scopes` + per-tenant rate floor), Streamable-HTTP-friendly upstream (long read timeout, no response buffering), correlation/OTel headers
- [ ] 1.2 Resolve tenant/workspace/server from the verified credential + path; proxy to the tenant's MCP-server ksvc (cross-tenant routing must fail)

## 2. Gateway-policy framework registration (keep validate:gateway-policy green)

- [ ] 2.1 Register the `mcp` route family in `charts/in-falcone/values.yaml` (`gatewayPolicy` / `bootstrap.reconcile.apisix.routes`) with the `product_api` route-kind label
- [ ] 2.2 Add the `mcp` family + qos timeout/retry profiles to `services/gateway-config/base/public-api-routing.yaml`
- [ ] 2.3 Add the `mcp` family entries to the public route catalog
- [ ] 2.4 `pnpm validate:gateway-policy` + `pnpm validate:repo` pass

## 3. Verify

- [ ] 3.1 Gateway-config contract tests pass (`services/gateway-config/tests`)
- [ ] 3.2 On `test-cluster-b`: a Streamable-HTTP request with a valid token routes through APISIX to a hosted MCP-server ksvc; missing/invalid token → 401; wrong per-tool scope → 403
- [ ] 3.3 Cross-tenant routing probe: tenant A token cannot reach tenant B's server

## 4. Finalize

- [ ] 4.1 `openspec validate add-mcp-gateway-ingress --strict`
- [ ] 4.2 Confirm additive (no change to existing route families) and that the runtime stays internal-only (gateway is the sole ingress)
