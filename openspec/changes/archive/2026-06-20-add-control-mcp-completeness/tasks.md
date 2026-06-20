## 1. Failing Tests (write before any implementation)

- [x] 1.1 Base scope auto-grant (HTTP): `tests/blackbox/platform-mcp-completeness.test.mjs::bbx-642-autograant-read` — an authenticated principal with NO `mcp:invoke` scope calls a read tool and gets content, not `-32001`.
- [x] 1.2 Catalog path correctness: `mcp-official-server.test.mjs` asserts `create_workspace` → `/v1/tenants/{tenantId}/workspaces` (served route), not the bare `/v1/workspaces`.
- [x] 1.3 Tenant injection: `{tenantId}` substituted from the credential; an argument-supplied `tenantId` reaches neither the path nor the body (covered in unit + blackbox).
- [x] 1.4 Catalog breadth: `OFFICIAL_TOOLS` exceeds 9 tools and spans ≥8 families (unit test).
- [x] 1.5 Authoring planner: `plan_project` valid spec → ordered plan referencing real tools; invalid spec → error (`mcp-authoring.test.mjs` + server test).
- [x] 1.6 Superadmin RBAC config: `set_mcp_config` refused for non-superadmin, applied for superadmin; a disabled tool is absent from `tools/list` and uncallable (unit + blackbox).

## 2. Implementation — mcp-config.mjs (new module)

- [x] 2.1 `apps/control-plane/src/mcp-config.mjs`: `createMcpConfigStore` (in-memory `enabled` + `disabledTools`); `get()`, `isToolEnabled()`, `isServerEnabled()`, `set(patch)`. Process-wide singleton `mcpConfigStore` (MCP_OFFICIAL_ENABLED default). The superadmin role gate lives in the handler (`SUPERADMIN_ROLES`), keeping the store pure.
- [x] 2.2 `get_mcp_config` (read) + `set_mcp_config` (mutating, superadmin-only via role) tools added to the catalog and dispatched in-process by `handleMcpMessage`.

## 3. Implementation — mcp-authoring.mjs (new module)

- [x] 3.1 `apps/control-plane/src/mcp-authoring.mjs`: pure `planProject(spec, {toolNames})` — validates input, emits ordered `{id,tool,arguments,dependsOn}[]` (workspace → database/functions/topics/buckets), throws `INVALID_SPEC` on bad input.
- [x] 3.2 `plan_project` wired into `handleMcpMessage` (kind `authoring`) and listed in `toolsListForClient`.

## 4. Implementation — mcp-official-catalog.mjs retarget

- [x] 4.1 Retargeted all tool paths to served routes; generalized named path params (`{tenantId}` credential-derived, others from args).
- [x] 4.2 Expanded `OFFICIAL_TOOLS` to 30+ tools across workspaces, tenant/users/auth, service-accounts, databases, functions, quotas/entitlements, observability, storage, events, webhooks, api-keys, embedding.

## 5. Implementation — base scope auto-grant

- [x] 5.1 Base scope granted in `runPlatformMcp` when the server is enabled (or always for a superadmin, to avoid a disabled-server lockout); mutating scope checks unchanged. The handler still enforces the base scope.

## 6. Implementation — runtime/server.mjs runPlatformMcp retarget

- [x] 6.1 `runPlatformMcp` dispatches against the executor loopback (`MCP_SELF_BASE_URL ?? http://127.0.0.1:${PORT}`, threaded from `main.mjs`); the executor's local routes + control-plane fallthrough reach every family.
- [x] 6.2 `{tenantId}` substituted from `c.identity.tenantId` in the handler's `resolvePath`; a smuggled `tenantId` argument is stripped from path and body.
- [x] 6.3 The `mcpConfigStore` singleton is passed into the handler context so `tools/list` + `tools/call` honor the enabled set.
- [x] 6.4 `mcp-engine.mjs` official re-host reconciled: only `kind:'proxy'` tools are re-hosted; routing now substitutes `{tenantId}` + arbitrary named params.

## 7. Update existing tests

- [x] 7.1 Updated `mcp-official-server.test.mjs`, `mcp-tool-call-execution.test.mjs`, `mcp-workflow-platform-binding.test.mjs` for the retargeted catalog.
- [x] 7.2 `bash tests/blackbox/run.sh` → 1039 pass / 0 fail; `apps/control-plane` unit → 84 + 27 MCP + 11 authoring/config pass; `openspec validate add-control-mcp-completeness --strict` clean.

## 8. Verification — live kind probe (test-cluster-b, 2026-06-20)

- [x] 8.1 Deployed the cp-executor (`mcp642-20260620`) and called `POST /v1/mcp/rpc` as a `tenant_owner` whose token carried `scope:"openid profile"` (NO `mcp:invoke`) — the exact `-32001` condition:
  - `tools/list` → **36 tools** (was 9), incl. `plan_project` + `set_mcp_config`.
  - `list_workspaces` → real own-tenant workspaces (tenant `c58ee69d…`), NOT `-32001`/404 — base-scope auto-grant + retargeted route proven.
  - `get_tenant` → tenant `acme` — `{tenantId}` substituted from the credential reaches a real route.
  - `plan_project` → ordered plan `create_workspace → provision_database → register_function`.
  - `set_mcp_config` (tenant_owner) → `-32002` "requires a platform superadmin role"; `create_workspace` without its scope → `-32002` (read-first preserved).
- [x] 8.2 Reverted the cp-executor to `head-20260619`; rollout complete; pod healthy; port-forwards stopped.

## 9. Archive

- [ ] 9.1 `/opsx:archive add-control-mcp-completeness` after merge.
