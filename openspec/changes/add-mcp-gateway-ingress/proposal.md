## Why

Remote MCP clients (Claude, Cursor, VS Code, claude.ai connectors) reach a tenant's hosted MCP server over **Streamable HTTP**, and ADR-12 decided to reuse the existing **APISIX** gateway (ADR-3) as the single, authenticated inbound surface — the runtime is internal-only and never tenant-exposed. This change adds the MCP inbound route family to the gateway: terminate Streamable HTTP, validate the tenant's **OAuth 2.1** access token, enforce **per-tool scopes** (per-tool RBAC), and proxy to the correct tenant-namespaced MCP-server ksvc — emitting OpenTelemetry per call. It resolves issue **#389** (epic #386); depends on #387 (ADR), #388 (runtime), #390 (OAuth AS); feeds #391/#392/#394/#397 (the servers reachable through it).

## What Changes

- Add an **MCP inbound route** in `services/gateway-config/routes/mcp-routes.yaml` (APISIX), mirroring the existing route YAMLs:
  - **`keycloak-openid-connect`** plugin — validate the OAuth 2.1 access token; reject missing/invalid → `401` (no fallback to client-supplied identity, ADR-2).
  - **`scope-enforcement`** plugin — enforce **per-tool `required_scopes`** (per-tool RBAC) and the per-tenant rate-limit floor (reuses `plugins/scope-enforcement.lua`).
  - **Streamable-HTTP-friendly upstream** — SSE-compatible timeouts (long read), proxy to the tenant's MCP-server ksvc; correlation-id / OTel headers.
- Register the **`mcp` route family** consistently across the gateway-policy framework so `validate:gateway-policy` stays green: `charts/in-falcone/values.yaml` (`gatewayPolicy` / `bootstrap.reconcile.apisix.routes`), `services/gateway-config/base/public-api-routing.yaml` (family + qos timeout/retry profiles), and the `public-route-catalog`.
- Routing selects the correct **tenant + server** so one tenant's token can never reach another tenant's server (cross-tenant routing probe must fail).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add requirements for the **inbound transport + gateway enforcement** (Streamable HTTP only via the gateway; OAuth 2.1 required; per-tool scope enforced; routed to the owning tenant's server). Builds on the foundational `mcp` capability (#387).
- `gateway`: add a requirement that the gateway exposes an **MCP route family** with OAuth + per-tool scope enforcement, consistent with the two-privilege-domain model (ADR-3).

## Impact

- **Gateway config:** `services/gateway-config/routes/mcp-routes.yaml`, `base/public-api-routing.yaml` (family + qos), `public-route-catalog`; `charts/in-falcone/values.yaml` `gatewayPolicy`.
- **Reuses:** APISIX (ADR-3), `plugins/scope-enforcement.lua`, `keycloak-openid-connect`. agentgateway remains the recorded fallback (ADR-12) if per-tool RBAC granularity proves insufficient.
- **No control-plane API change here** — the MCP management API (CRUD/connect) is #391/#397. Token issuance/consent is #390. Quotas/rate-limit policy is #399.
- **Caveat:** internal-only enforcement of the runtime relies on the #388 NetworkPolicy, which needs a policy-enforcing CNI (kindnet does not enforce — ADR-12).
