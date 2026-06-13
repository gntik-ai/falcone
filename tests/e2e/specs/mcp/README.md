# MCP E2E suite (issue #402, epic #386)

Real-stack Playwright specs for the MCP capability, following the repo's kind/Helm conventions
(`tests/e2e/stack.sh`, ephemeral namespace, always torn down via the `run.sh` / `run-issue.sh` trap).

## Specs

- `mcp-full-loop.spec.ts` — create/generate → curate → deploy → connect via OAuth → call a tool → observe in the audit.
- `mcp-cross-tenant.spec.ts` — tenant B cannot reach tenant A's server, tools, logs, or OAuth credentials.
- `mcp-version-pinning.spec.ts` — an unapproved tool-description change is held for review and not served; the prior version keeps serving.
- `../issues/add-mcp-e2e.spec.ts` — per-issue smoke for `run-issue.sh add-mcp-e2e`.

## Live capability gate (current state)

The control-plane runtime (`apps/control-plane/src/runtime/server.mjs`) serves
`/v1/{postgres,mongo,events,functions,realtime,flows}` but **not** `/v1/mcp/...` — the MCP
control-plane modules (#391–#399) are pure and **not yet wired into the live control-plane**. So
every spec begins with `probeMcpManagement`: if the management API is not served, the spec
**skips with a precise reason** (`MCP_MANAGEMENT_GATE_REASON`) instead of failing. The moment those
routes are wired, the specs execute the full loop unchanged.

This is verified: against an absent/unreachable control-plane the suite reports **12 skipped, 0 failed** —
the harness is deploy-ready and honest, not a fabricated green.

## Run

```sh
# Per-issue (deploys, runs the smoke, always tears down):
bash tests/e2e/run-issue.sh add-mcp-e2e

# Full MCP suite against a running stack (deploy the MCP runtime: mcp.enabled=true):
#   helm ... --set mcp.enabled=true   (via E2E_HELM_VALUES or --set)
cd tests/e2e && npx playwright test specs/mcp
```

Override the control-plane URL with `E2E_CP_BASE_URL` (default `http://localhost:8080`, the
`stack.sh` port-forward). The A/B tenants are the canonical fixed-UUID E2E tenants.
