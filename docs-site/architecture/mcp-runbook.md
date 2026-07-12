# MCP Runbook (Operations)

Operator procedures for the MCP server hosting capability. For the design see
[MCP Architecture](/architecture/mcp); for the tenant guide see [MCP Server Hosting](/guide/mcp);
for the decision record see
[ADR-12](/architecture/adrs#adr-12-mcp-server-hosting-runtime-gateway-oauth-and-isolation).

## Configure

The MCP chart wiring is part of the core Falcone baseline. Tune its NetworkPolicy and quota values
in Helm values:

```yaml
mcp:
  networkPolicy:
    enabled: true
    gatewayNamespaces: [knative-serving, kourier-system]
  quotas:
    mode: enforced            # enforced | unbounded
    maxServersPerTenant: 10
    maxToolsPerServer: 50
    toolCallsPerMinutePerServer: 600
    toolCallsPerMinutePerOAuthClient: 300
```

The chart deploys the RBAC + the internal-only NetworkPolicy (`../falcone-charts/charts/in-falcone/templates/mcp/`). MCP
servers themselves are Knative Services created per tenant; they require Knative Serving + Kourier
(already used by functions). OpenShift overlays inherit the non-root `securityContext`.

## Network isolation & the CNI caveat

The NetworkPolicy (`<release>-mcp-server-internal-only`) selects
`in-falcone.io/component: mcp-server`: inbound only from the Knative ingress namespaces, egress only
to DNS + the platform namespace — so a server cannot reach another tenant's services.

::: warning NetworkPolicy enforcement needs a policy CNI
NetworkPolicy is honored **only under a policy-enforcing CNI (Calico/Cilium)**. The kind test
cluster runs **kindnet, which does not enforce it** — the policy applies cleanly and selects the
right pods (verified with `kubectl apply --dry-run=server`), but the behavioral cross-namespace
isolation proof must run on a policy CNI in production/CI.
:::

## OAuth Authorization Server

Per-tool scopes are Keycloak client scopes; clients are registered through the control-plane's
curated DCR plan (never via raw Keycloak admin). The Keycloak admin credential is the
`in-falcone-keycloak-admin` secret (keys `username` / `password`) in the platform namespace. The
realm's OIDC discovery exposes the dynamic client registration endpoint
(`/realms/{realm}/clients-registrations/openid-connect`) and the `authorization_code` /
`client_credentials` / `refresh_token` grants.

## Supply-chain controls

A server version is only registered when its image is **digest-pinned** (`image@sha256:…`). Deploy
is rejected for an unpinned / `latest` image, a registry not on the allow-list, or a signature that
did not verify (cosign verdict injected at the deploy path). A version bump that changes a tool's
description or scope is **held for review** and does not serve until approved; **rollback**
re-activates a prior approved digest.

## Quotas & rate limits

Defaults are in `mcp.quotas` (above); the resolved plan overrides them per tenant. `enforced` blocks
on breach (`QUOTA_EXCEEDED` for server/tool counts, `RATE_LIMITED` HTTP 429 + `retryAfter` for tool
calls); `unbounded` never blocks. Breaches are recorded in the `mcp` audit subsystem. MCP usage
appears in the per-tenant quota posture via the `mcp_tool_invocations` dimension.

## Scale-to-zero

Servers run with `min-scale: 0`. An idle server scales to zero (~30s) and cold-starts on the next
request (~1.2s observed in the ADR-12 spike). No idle cost.

## Observability

Tool-call metrics: `in_falcone_mcp_tool_invocations_total` (domain `mcp_tool_usage`) + latency on
`in_falcone_component_operation_duration_seconds` (`subsystem=mcp`). Audit: the `mcp` subsystem in
the audit pipeline, queryable tenant-scoped in the console. All MCP observability/audit contracts are
enforced by the `validate:observability-*` gates and the contract unit tests.

## E2E suite

The real-stack Playwright suite lives at `tests/e2e/specs/mcp/` (full loop, cross-tenant isolation,
version-pinning) with a per-issue smoke at `tests/e2e/specs/issues/add-mcp-e2e.spec.ts`. Run it with
the standard runner (ephemeral namespace, always torn down):

```sh
bash tests/e2e/run-issue.sh add-mcp-e2e        # per-issue
cd tests/e2e && npx playwright test specs/mcp   # full MCP suite (needs a running stack)
```

The specs probe whether the control-plane serves the MCP management API and **skip with a precise
reason** when it is absent — so they never report a false green. They execute the full loop the
moment the routes are wired.

## Runtime state and verification

The control-plane runtime (`apps/control-plane/src/runtime/server.mjs`) serves `/v1/mcp/...`
management routes when the core chart sets `MCP_ENABLED=true`. Registry, version, audit, and
rate-limit state is durable in PostgreSQL through the control-plane metadata pool; the memory
store is retained only for unit tests. Operational verification should create, curate, publish, call,
and audit a server, then restart the control-plane/executor and confirm the server record and audit
history remain available.

## Common failure modes

| Symptom | Likely cause | Action |
| --- | --- | --- |
| MCP server pod not reachable from the gateway | NetworkPolicy ingress namespace mismatch | confirm `mcp.networkPolicy.gatewayNamespaces` match the Knative ingress namespaces |
| Cross-namespace traffic not blocked on kind | kindnet does not enforce NetworkPolicy | run isolation tests on a Calico/Cilium cluster |
| Deploy rejected | image unpinned / unsigned / disallowed registry | pin by digest, sign, and allow-list the registry |
| New version not serving | tool description/scope changed → held for review | approve the version, or roll back |
| Tool calls returning 429 | per-server / per-OAuth-client rate limit | raise the plan limit or back off; check the `mcp` audit for the breach |
| `/v1/mcp` returns 404 | `MCP_ENABLED` absent/false, stale gateway route, or unhealthy control-plane runtime | confirm the core chart rendered `MCP_ENABLED=true`, the `/v1/mcp/*` gateway route, and healthy control-plane pods |
