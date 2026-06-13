## Context

The flows E2E suite (`tests/e2e/specs/flows/`) is the precedent: Playwright `.spec.ts` files use `APIRequestContext` to call the control-plane directly with gateway-injected identity headers (`x-tenant-id`, `x-workspace-id`, …), two fixed-UUID A/B tenants back cross-tenant probes, and `stack.sh` Helm-installs into an ephemeral namespace that `run.sh`/`run-issue.sh` always tear down via a trap. The MCP suite mirrors this exactly.

The decisive constraint: `apps/control-plane/src/runtime/server.mjs` serves `/v1/{postgres,mongo,events,functions,realtime,flows}` but **no `/v1/mcp` routes** — the MCP modules (#391–#399) are pure logic and contracts, never wired into the live control-plane. So a full-loop MCP E2E cannot pass today without fabricating a server that does not exist.

## Goals / Non-Goals

**Goals:** a conventions-complete MCP E2E suite (full-loop, cross-tenant, version-pinning) that runs the real loop the moment the control-plane serves MCP, and behaves honestly today (skip-with-reason, never a false green); A/B isolation probes; a per-issue runner entry.

**Non-Goals:** wiring the MCP management API into the control-plane (a separate feature/issue — the named follow-up); non-MCP E2E; load testing.

## Decisions

- **Mirror the flows suite.** Same helper shape (`tenant-fixtures` + `*-api-client` + identity headers), same A/B fixed UUIDs, same `stack.sh`/`run-issue.sh` lifecycle. New engineers find it where they expect.
- **Live capability gate, not a fake.** Each spec's `beforeAll` calls `probeMcpManagement`; a 404/unreachable means the management API is not served, and `test.skip(reason)` records exactly why. A 200/401/403 means the route exists and the spec runs for real. This keeps the suite truthful: verified `12 skipped, 0 failed` against an absent control-plane — the harness is real, the gap is explicit.
- **Cover all three acceptance loops as specs now.** Full-loop, cross-tenant, and version-pinning are authored against the intended MCP management API shape (`/v1/mcp/workspaces/{ws}/servers` + curations/versions/tool-calls/audit), so they are ready and reviewable; they go green when the routes land.
- **Per-issue smoke.** `specs/issues/add-mcp-e2e.spec.ts` gives `run-issue.sh add-mcp-e2e` a single representative spec (probe → create/get/delete), deploy-and-teardown via the existing trap.

## Risks / Trade-offs

- *Specs skip today* → intentional and honest; the alternative (a green that does not exercise the system) would be misleading. The skip reason names the exact wiring follow-up.
- *API shape may shift when wired* → the client is isolated in one helper; adjusting paths/bodies is a one-file change.

## Migration Plan

Additive: new helpers + specs + README under `tests/e2e`. No change to `stack.sh`'s generic logic; the MCP runtime is enabled via `mcp.enabled=true` at deploy. When the control-plane serves `/v1/mcp`, the gate flips and the suite runs.

## Open Questions

- Final MCP management route shapes once wired into `runtime/server.mjs` (the client mirrors the gateway's workspace-scoped pattern + the console #397 paths).
- Whether the playwright config gets a dedicated `mcp` project (currently the specs run under the default project).
