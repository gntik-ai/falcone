# MCP Architecture

The **MCP server hosting** capability lets a tenant publish curated tools that AI agents call over
**Streamable HTTP** with **OAuth 2.1**, scoped to the tenant. It **reuses** Falcone's existing
platform rather than adding new infrastructure: the Knative per-tenant runtime, the APISIX gateway,
and the realm-per-tenant Keycloak. For the decision record see
[ADR-12](/architecture/adrs#adr-12-mcp-server-hosting-runtime-gateway-oauth-and-isolation); the
tenant-facing guide is [MCP Server Hosting](/guide/mcp); operator procedures are in the
[MCP Runbook](/architecture/mcp-runbook). The normative spec deltas live under
`openspec/changes/add-mcp-*/specs/mcp/`.

## Component map

```
 console / CLI / agent client                control plane (pure modules)                   runtime
 ───────────────────────────                 ────────────────────────────                   ───────
 console Connect + Playground  ──HTTP──▶ mcp-official-{catalog,server}   ──deploy spec──▶  Knative ksvc
 falcone mcp init/dev/deploy            mcp-instant-generator → mcp-curation                (in-falcone.io/component:
 Cursor / Claude Code / VS Code         mcp-registry (versions, digests)                     mcp-server, min-scale 0)
 claude.ai connector                    mcp-quota (quotas + rate limits)                          ▲
        │                               mcp-observability (metrics + audit)                       │ Streamable HTTP
        │ OAuth 2.1                      mcp-workflows-tools (flows → Tasks)              ┌─────────┴─────────┐
        ▼                               mcp-oauth (DCR + per-tool scopes)                │  APISIX gateway   │
 Keycloak (realm-per-tenant) ◀──────────────────────────────────────────────────────── │ scope-enforcement │
 OAuth 2.1 Authorization Server                                                          └───────────────────┘
```

## Runtime — reuse Knative (ADR-12)

Each MCP server is a **Knative Service (ksvc)** in the tenant's namespace, carrying
`in-falcone.io/component: mcp-server` and `in-falcone.io/tenant: <tenantId>`. The deploy spec is a
pure builder (`apps/control-plane/src/mcp-custom-hosting.mjs` → `buildCustomServerDeployment`):
non-root, `min-scale: 0` (scale-to-zero), OpenShift-safe `securityContext`. The chart component
(`charts/in-falcone/templates/mcp/`) ships RBAC + the NetworkPolicy, off by default
(`mcp.enabled: false`). Supply-chain: the image must be **digest-pinned**, from an allow-listed
registry, and signature-verified before deploy.

## Gateway — reuse APISIX (ADR-3)

Inbound MCP traffic terminates at APISIX (`services/gateway-config/routes/mcp-routes.yaml`, route
`/v1/mcp/workspaces/*/servers/*`): `keycloak-openid-connect` validates the OAuth token and
`scope-enforcement` (path-derived) enforces the per-tool scope; SSE is supported for streaming.
The runtime and operator are **internal-only** — MCP-server pods are never directly reachable.

## OAuth 2.1 Authorization Server — extend Keycloak (ADR-12)

The realm-per-tenant Keycloak is the OAuth 2.1 AS. `apps/control-plane/src/mcp-oauth.mjs` derives
**per-tool scopes** (a tool's scope = a Keycloak client scope) and builds the curated **dynamic
client registration** plan (`buildMcpOAuthProvisioningPlan`, an ADR-4 adapter plan over
`keycloak-admin`) — the control-plane curates DCR; raw Keycloak admin is never exposed. Grants:
`authorization_code` + `client_credentials` + `refresh_token`. Consent reuses the approval-flow
precedent.

## Curation & the official/instant servers

`mcp-instant-generator` turns a resource (Postgres schema, function, storage, events) into a
**draft** manifest (`{ status: 'draft', requiresCuration: true }`) — never publishable raw.
`mcp-curation` applies enable/disable + description/scope decisions and **gates publish** (every
enabled mutating tool needs a scope; ≥1 enabled tool); only a **published** manifest is connectable.
`mcp-official-{catalog,server}` provide curated, read-first platform tools (GET = read base scope;
POST/PUT/DELETE = mutating with an explicit `mcp:falcone:<area>:write` scope), with the tenant
credential-derived and never taken from tool arguments.

## Registry, versioning & supply-chain

`mcp-registry.mjs` keeps a per-tenant registry keyed by `(tenantId, serverId)`: each version pins an
**immutable `sha256:` digest** + manifest + source + signature verdict. `diffVersions` surfaces
added/removed tools and changed descriptions/scopes; a tool-facing change marks the new version
`requiresReview`, and `activateVersion` refuses to serve it until approved — the **rug-pull guard**.
`rollbackToVersion` re-activates a prior approved version. `verifyImageForDeploy` is the deploy gate
(pinned + allowed registry + verified signature), reusing the platform image-policy rules; the
cosign verdict is injected (ADR-4) and enforced.

## Tenancy, isolation & quotas

Isolation is layered: the internal-only **NetworkPolicy** (egress = DNS + platform namespace only),
the gateway-only endpoint, the tenant-scoped **registry** and **audit**, and realm-per-tenant
**OAuth**. `mcp-quota.mjs` enforces per-tenant server/tool quotas and per-server/per-OAuth-client
tool-call rate limits with an enforcement mode (`enforced` | `unbounded`); rate-limit keys are
`mcp:rl:<tenant>:<server>(:oac:<client>)` so a budget never crosses tenants. Breaches return
`QUOTA_EXCEEDED`/`RATE_LIMITED` (429) and are audited.

## Observability

`mcp-observability.mjs` shapes each tool call into a usage metric
(`in_falcone_mcp_tool_invocations_total`, business domain `mcp_tool_usage`), a latency observation on
the normalized `in_falcone_component_operation_duration_seconds` family (`subsystem=mcp`), and a
structured log — all attributed to tenant/workspace/server/tool/oauth-client, with no PII labels.
Per-OAuth-client governance events land in the **`mcp` audit subsystem**; the audit query is
tenant-scoped (cross-tenant records are filtered out).

## Flows as tools

`mcp-workflows-tools.mjs` maps a published Flow (ADR-11) to a long-running MCP tool via the **Tasks
extension**: invoking it starts a durable execution and returns a Task handle keyed by the
`executionId`; the execution status maps to the MCP Task status. Live-verified against a real
Temporal dev server.

## Status and maturity

The MCP capability is built as **pure control-plane modules + internal contracts + the chart
component + de-risking spikes + a real-stack E2E suite** (epic #386). The control-plane runtime
(`apps/control-plane/src/runtime/server.mjs`) does **not yet serve `/v1/mcp/...` management routes** —
the modules above are pure logic and contracts, not yet wired into the live HTTP server. Wiring them
in is the remaining integration that turns the [E2E suite](/architecture/mcp-runbook#e2e-suite)
green; until then the management API is exercised by unit tests and the spikes. This is tracked on
the [Roadmap](/guide/roadmap).
