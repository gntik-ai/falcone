## Context

ADR-3 fronts the whole platform with APISIX split into two privilege domains, enforced by `plugins/scope-enforcement.lua` (required_scopes + required_entitlements + per-tenant rate limit) on top of `keycloak-openid-connect`. Routes are declared as APISIX route YAMLs under `services/gateway-config/routes/`, and the gateway-policy framework (`charts/in-falcone/values.yaml` `gatewayPolicy`, `services/gateway-config/base/public-api-routing.yaml` families + qos profiles, the `public-route-catalog`) is cross-checked by `scripts/validate-gateway-policy.mjs`. ADR-12 chose to reuse this gateway for MCP rather than add agentgateway.

## Goals / Non-Goals

**Goals:**
- A single authenticated **Streamable-HTTP** inbound for hosted MCP servers, validating OAuth 2.1 and enforcing per-tool scopes, proxying to the tenant-namespaced ksvc.
- Keep `validate:gateway-policy` green by registering the MCP family consistently across the framework artifacts.

**Non-Goals:**
- Token issuance / consent / DCR (#390); the MCP management API (#391/#397); quota/rate-limit policy and isolation enforcement (#399); the servers' contents (#391/#392/#394).

## Decisions

- **Reuse APISIX (ADR-12).** Add an `mcp` route family rather than introduce agentgateway; the existing `scope-enforcement.lua` already does per-scope + per-tenant-rate enforcement, so per-tool RBAC = `required_scopes` derived from the published tool set (#390/#393). agentgateway stays the recorded fallback if per-tool RBAC granularity is insufficient.
- **Streamable HTTP, SSE-friendly.** The MCP route uses a long read timeout and disables response buffering so server-streamed responses flow (consistent with the realtime SSE precedent, `?apikey=`/Bearer). stdio is never exposed remotely.
- **Per-tenant + per-server routing.** The route resolves tenant/workspace/server from the verified token + path (credential-derived, ADR-2) and proxies to that tenant's ksvc; a token for tenant A can never be routed to tenant B's server.
- **Framework consistency.** Register the family in `values.yaml gatewayPolicy` (apisix route + qos), `base/public-api-routing.yaml`, and the `public-route-catalog` so `validate:gateway-policy` passes — the route YAML alone is not sufficient for the contract.

## Risks / Trade-offs

- *Per-tool RBAC granularity in APISIX* → if `required_scopes` per route can't express per-tool granularity cleanly, fall back to agentgateway (ADR-12); validated during apply.
- *SSE/streaming through APISIX* → verify long-lived Streamable-HTTP responses aren't buffered/cut; tune upstream timeouts.
- *Gateway-policy coupling* → the family must be added to all framework artifacts together or `validate:gateway-policy` fails; done atomically.

## Migration Plan

Additive: the MCP family is gated/off until the servers exist (#391/#392/#394) and OAuth (#390) lands. No existing route changes. Rollback = remove the MCP family entries.

## Open Questions

- Exact path shape for the inbound (`/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/…` vs per-server subdomain) — finalized with the management API (#391) and Connect UX (#397).
- Whether per-tool scope is enforced at the gateway (coarse, per-route) or also inside the server via the SDK (#401) — likely both (defense in depth).
