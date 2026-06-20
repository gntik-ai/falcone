## Why

On every kind deployment the first-party control-MCP server (`POST /v1/mcp/rpc`) fails every `tools/call` with `-32001 missing required scope: mcp:invoke`. The `mcp:invoke` base scope is defined in `apps/control-plane/src/mcp-official-catalog.mjs::BASE_SCOPE` but is never granted to an authenticated tenant principal at provisioning time, so the read-first guarantee stated in the existing spec requirement is unreachable in practice. Separately, 7 of the 9 existing tool paths in `OFFICIAL_TOOLS` target public-route-catalog shapes (e.g. `GET /v1/workspaces`, `POST /v1/functions`) that the runtime does NOT serve at those paths; the kind executor serves `GET /v1/tenants/{tenantId}/workspaces` and similar, causing hard 404s on the upstream even when a scope would eventually be provisioned. Beyond the blocking bugs the catalog exposes only 9 tools (5 read, 4 mutating) covering workspaces, schemas, and functions while the management surface spans API keys, service accounts, databases, storage, events, webhooks, quotas, and observability. There is no authoring/planning tool, no runtime configuration gate for superadmins, and the tool set is a deploy-time constant. Resolves GitHub issue #642.

Evidence: `apps/control-plane/src/mcp-official-catalog.mjs::OFFICIAL_TOOLS` (9 tools, path `/v1/workspaces` etc.); `apps/control-plane/src/runtime/server.mjs::runPlatformMcp` (no scope grant, proxies to `controlPlaneUpstream` with catalog paths); `falcone-capability-tests/evidence/p12-control-mcp.json` (live evidence: every `tools/call` returns `-32001 missing required scope: mcp:invoke`; scope-gate test fires at wrong layer); `deploy/kind/executor-demo.yaml:114` (`MCP_SELF_BASE_URL=http://127.0.0.1:8080` defined for self-call but unused by the platform dispatcher).

## What Changes

- **Fix base scope auto-grant**: grant the `mcp:invoke` base scope to every authenticated tenant principal when the first-party MCP server is enabled, so a read tool is callable end-to-end without a separately-provisioned scope. Mutating tools still require their explicit named per-tool scope (`mcp:falcone:*`).
- **Retarget catalog paths**: remap all 9 existing tool paths from public-route-catalog shapes to the routes the runtime actually serves (tenant-scoped paths from `deploy/kind/control-plane/routes.mjs` and `apps/control-plane/src/runtime/server.mjs`). Inject the credential-derived `{tenantId}` into tenant-scoped path segments; tool arguments supply only non-tenant parameters and request bodies. The `callFalcone` helper in `runPlatformMcp` resolves against `MCP_SELF_BASE_URL` (loopback, not `controlPlaneUpstream`) so local executor routes and the control-plane fallthrough both reach real handlers.
- **Expand the tool catalog**: add tools covering the tenant management families not yet represented: API keys, service accounts & credentials, databases, function registry, tenant users & auth config, quotas & entitlements, observability/metrics, storage, events, webhooks, embedding configuration. The catalog remains a curated subset (not a 1:1 export); every tool carries a description, input schema, and read/mutating classification.
- **Add deterministic authoring planner**: new module `mcp-authoring.mjs` exposes a `plan_project` tool that accepts a declarative desired-state project spec and returns an ordered, validated plan of catalog tool calls (reason → define → deploy scaffold). No external LLM is invoked in the control plane; the reasoning is performed by the MCP client and the server provides the deterministic define → deploy plan. Invalid/under-specified specs are rejected with a validation error and no plan.
- **Add superadmin RBAC configuration**: new module `mcp-config.mjs` provides an in-memory enabled/disabled tool registry, a `get_mcp_config` read tool (available to authenticated principals), and a `set_mcp_config` mutating tool gated on `identity.roles` containing `superadmin` or `platform_admin` (per the `KEY_MGMT_ADMIN_ROLES` convention from `#624`). A disabled tool is absent from `tools/list` and uncallable.

## Capabilities

### New Capabilities

_(none — all changes extend the existing `mcp` capability)_

### Modified Capabilities

- `mcp`: MODIFY the existing read-first server requirement to add base-scope auto-grant and credential-derived tenant path resolution; ADD requirements for route correctness, catalog breadth, authoring planner, superadmin RBAC config, and end-to-end tool call success.

## Impact

- `apps/control-plane/src/mcp-official-catalog.mjs` — retarget all tool paths to served routes; expand `OFFICIAL_TOOLS` to cover new management families; add read/mutating classification metadata for each
- `apps/control-plane/src/mcp-official-server.mjs` — `handleMcpMessage`: auto-grant `mcp:invoke` to authenticated principals when server enabled; resolve `{tenantId}` from credential (never from args)
- `apps/control-plane/src/runtime/server.mjs::runPlatformMcp` — target `MCP_SELF_BASE_URL` (env `MCP_SELF_BASE_URL` ?? `http://127.0.0.1:${PORT}`) instead of `controlPlaneUpstream` for tool dispatch; preserve authorization forwarding
- `apps/control-plane/src/mcp-authoring.mjs` — NEW: deterministic `plan_project` authoring tool
- `apps/control-plane/src/mcp-config.mjs` — NEW: in-memory config, `get_mcp_config` / `set_mcp_config` with superadmin gate
- `tests/blackbox/control-mcp-completeness.test.mjs` — NEW: black-box tests covering scope auto-grant, path correctness, catalog breadth, authoring planner, and RBAC config gate
