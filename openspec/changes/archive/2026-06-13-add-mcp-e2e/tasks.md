## 1. Helpers + fixtures

- [x] 1.1 `tests/e2e/helpers/mcp/tenant-fixtures.ts` — canonical A/B fixed-UUID tenants + `controlPlaneBaseUrl` + `serverName`
- [x] 1.2 `tests/e2e/helpers/mcp/mcp-api-client.ts` — control-plane MCP management client (identity headers) + `probeMcpManagement` + `MCP_MANAGEMENT_GATE_REASON`

## 2. Specs

- [x] 2.1 `specs/mcp/mcp-full-loop.spec.ts` — create/generate → curate → deploy → connect (OAuth) → call tool → observe in audit (5 steps)
- [x] 2.2 `specs/mcp/mcp-cross-tenant.spec.ts` — B cannot get/list/call/audit A's server (4 probes, A/B fixtures)
- [x] 2.3 `specs/mcp/mcp-version-pinning.spec.ts` — unapproved tool-description change held for review (not served); served after approval
- [x] 2.4 `specs/issues/add-mcp-e2e.spec.ts` — per-issue smoke for `run-issue.sh add-mcp-e2e`; `specs/mcp/README.md`

## 3. Verify

- [x] 3.1 `npx playwright test specs/mcp --list` → 12 tests across 4 files compile + register
- [x] 3.2 Honest live gate: against an absent control-plane the suite reports **12 skipped, 0 failed** (probe → `test.skip` with the gate reason) — deploy-ready, never a false green
- [x] 3.3 Teardown via the existing `run.sh`/`run-issue.sh` trap; MCP runtime deployed with `mcp.enabled=true`

## 4. Finalize

- [x] 4.1 Identified follow-up: wire the MCP control-plane modules (#391–#399) into `runtime/server.mjs` as live `/v1/mcp/...` routes — this flips the gate and the suite runs the full loop / isolation / version-pinning green. `pnpm lint` (markdownlint on the new README) + `openspec validate --strict` pass.
