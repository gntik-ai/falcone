## Context

The first-party control-MCP server is defined across two modules: `apps/control-plane/src/mcp-official-catalog.mjs` (exports `OFFICIAL_TOOLS` — 9 tools, `BASE_SCOPE = 'mcp:invoke'`, `toolsListForClient`, `toolByName`) and `apps/control-plane/src/mcp-official-server.mjs` (exports `handleMcpMessage` — JSON-RPC dispatcher). The executor registers the endpoint at `POST /v1/mcp/rpc` via `runPlatformMcp` in `apps/control-plane/src/runtime/server.mjs:537`. The `runPlatformMcp` function builds a `callFalcone` client that proxies to the operator-configured `controlPlaneUpstream`, but the catalog tool paths target `GET /v1/workspaces`, `POST /v1/functions`, etc. — routes the kind runtime does not serve at those paths. On kind, tenant-scoped routes live under `/v1/tenants/{tenantId}/workspaces` and similar, so every proxied call 404s before scope checks even matter.

The blocking runtime bug is compounded by the missing base-scope grant: `handleMcpMessage` checks `grantedScopes.has(BASE_SCOPE)` from `ctx.grantedScopes`, which is populated from `c.identity?.scopes`. On kind the `mcp:invoke` scope is never provisioned for tenant principals. Live evidence in `falcone-capability-tests/evidence/p12-control-mcp.json` confirms every `tools/call` returns `-32001 missing required scope: mcp:invoke`.

The MCP hosting engine already self-calls (`apps/control-plane/src/runtime/main.mjs:304` sets `selfBaseUrl: process.env.MCP_SELF_BASE_URL ?? ...`; `apps/control-plane/src/runtime/mcp-engine.mjs:60` consumes it). The `deploy/kind/executor-demo.yaml:114` YAML sets `MCP_SELF_BASE_URL=http://127.0.0.1:8080` but `runPlatformMcp` does not use this env var — it always targets `controlPlaneUpstream` (the external legacy CP URL). This is the architectural mismatch: tool calls must go through the executor's own loopback to hit tenant-scoped routes served locally plus reach the control-plane via the existing fallthrough proxy (`server.mjs:836`).

## Goals / Non-Goals

**Goals:**
- End-to-end read tool calls succeed on a standard kind deployment without manual scope provisioning.
- Every catalog tool path resolves to a route the runtime actually handles or proxies correctly.
- The credential-derived `{tenantId}` is always injected into tool paths; tool arguments never supply it.
- The tool catalog covers the primary tenant management families at a curated but meaningful breadth.
- A deterministic authoring planner (`plan_project`) is available as a first-party tool; no external LLM is called in the control plane.
- Superadmins can enable/disable individual tools at runtime; the config is readable by any authenticated principal.

**Non-Goals:**
- Persistent configuration storage for the enabled/disabled tool set (in-memory is acceptable for the initial implementation, matching the pattern of existing in-memory state in the control-plane).
- Generating a 1:1 export of every management API route as a tool.
- Invoking an external LLM from the server side for reasoning — reasoning stays in the MCP client.
- Changing the existing hosted MCP engine for per-tenant servers (`/v1/mcp/workspaces/...`).
- Keycloak realm changes or OAuth scope provisioning via Keycloak (the base scope is auto-granted in the handler, not via the OAuth flow).

## Decisions

**Retarget catalog paths to served routes.** `OFFICIAL_TOOLS` paths are updated from public-route-catalog shapes to the routes the runtime actually serves. Tenant-scoped families use the pattern `GET /v1/tenants/{tenantId}/workspaces`; the `{tenantId}` segment is always resolved from the credential (`c.identity.tenantId`) in `runPlatformMcp` before path construction. Other named segments (e.g. `{workspaceId}`, `{id}`) continue to come from tool arguments. The `callFalcone` helper in `runPlatformMcp` substitutes `{tenantId}` from the credential before the HTTP call, using `encodeURIComponent`. Tool argument-supplied tenant values are silently ignored.

**Dispatch to `MCP_SELF_BASE_URL` (loopback).** `runPlatformMcp` is changed to build `callFalcone` against `process.env.MCP_SELF_BASE_URL ?? http://127.0.0.1:${PORT}` instead of `controlPlaneUpstream`. This lets tool calls reach both the executor's own local routes (data plane, DDL, API keys, webhooks, etc.) and the control-plane's management routes via the existing fallthrough proxy at `server.mjs` — the same loopback approach the MCP hosting engine uses (`main.mjs:304`, `mcp-engine.mjs:60`). Authorization headers are forwarded unchanged (the bearer token is already verified by the gateway; forwarding it to the loopback preserves the identity chain).

**Base scope auto-grant.** When the first-party server handles a `tools/call`, `handleMcpMessage` checks whether the caller is authenticated (identity present). If authenticated and the server is enabled, `mcp:invoke` is treated as automatically granted regardless of the token's scope claim. This is implemented by pre-populating `grantedScopes` with `BASE_SCOPE` inside `runPlatformMcp` when `c.identity` is present, before passing to `handleMcpMessage`. Mutating tools still require their explicit per-tool scope from the token; the auto-grant only covers the base read gate.

**New module `mcp-authoring.mjs`.** Exports a `AUTHORING_TOOLS` array (a single `plan_project` tool) and a `handleAuthoringTool(name, args, catalog)` pure function. The planner validates the input spec against a minimal schema (workspace name required; optional list of databases and functions), then produces an ordered array of `{ tool, arguments }` steps referencing real catalog tool names. No I/O; the function is independently unit-testable. `handleMcpMessage` delegates to it when the tool name is `plan_project`.

**New module `mcp-config.mjs`.** Exports an in-memory `McpConfig` class with `getConfig()`, `setConfig(patch, identity)`, and `isToolEnabled(name)`. `setConfig` checks `identity.roles` for `superadmin` or `platform_admin` (matching the `KEY_MGMT_ADMIN_ROLES` pattern from `#624`) and throws a `403`-coded error if neither role is present. `get_mcp_config` is a read tool (base scope only); `set_mcp_config` is a mutating tool gated on both `mcp:falcone:mcp:write` scope and the superadmin role. `toolsListForClient` and `toolByName` filter against `McpConfig.isToolEnabled`.

**Superadmin gate follows `KEY_MGMT_ADMIN_ROLES` convention.** Role names checked: `['superadmin', 'platform_admin']`, drawn from `identity.roles` (populated by `identityFromHeaders` from the `x-actor-roles` trust header, `apps/control-plane/src/runtime/server.mjs:98–105`). This is identical to the API-key management admin gate introduced in `#624`.

## Risks / Trade-offs

- **In-memory config is lost on restart.** Acceptable for the initial implementation; persistent config can be added in a follow-on change using the same store pattern as other in-memory capability state.
- **Loopback self-call adds a hop.** The tool call traverses the executor's own HTTP handler a second time (loopback). On kind (single instance, low concurrency) this is negligible; in a horizontally-scaled deployment a load balancer in front of the loopback address would round-robin, which is fine since all replicas share the same in-memory config object per process. This matches the existing MCP hosting engine pattern.
- **Base scope auto-grant bypasses OAuth provisioning.** Granting `mcp:invoke` implicitly for authenticated principals means any token-bearing caller can list and call read tools. This is the intended design (read-first) and is consistent with the spec requirement; it trades explicit scope management for zero-friction read access.
