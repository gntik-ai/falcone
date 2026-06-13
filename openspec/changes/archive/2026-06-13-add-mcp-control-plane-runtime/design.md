## Context

The MCP epic deliberately delivered pure modules + contracts + chart + spikes + an E2E harness, but never wired the runtime. The runtime (`apps/control-plane/src/runtime/server.mjs`, built into the `in-falcone-control-plane-executor` image, deployed as `falcone-cp-executor`) is a route table `[method, RegExp, handler(groups, ctx), opts]`; capabilities are gated by injected executors (flows are registered only when `flowExecutor` is injected); identity comes from `resolveIdentity` (gateway headers / api-key / JWT) with `tenantId` required; the central error handler already echoes `err.dimension` on a 429. This change follows that pattern exactly.

## Goals / Non-Goals

**Goals:** serve the MCP management API live; compose the existing modules without changing them; enforce the same tenant boundary as every route; pass the MCP E2E suite on kind.

**Non-Goals:** rewriting the MCP modules; a durable (Postgres) registry; per-server Knative ksvc deployment + direct MCP-protocol connection (the control-plane mediates tool calls); a new OAuth/gateway path (reuses the existing identity headers).

## Decisions

- **An engine, not new logic.** `runtime/mcp-engine.mjs` is the integration seam (like `flow-executor.mjs`): `executeMcp({operation, identity, …})` dispatches to the pure modules. The modules are imported and called as-is.
- **Honor the registry's digest contract.** `mcp-registry.registerVersion` requires a digest-pinned image. Platform-served (instant/official) servers run on the platform MCP runtime image, so the engine pins `MCP_RUNTIME_IMAGE@<digest>` for their versions — satisfying the contract without modifying it. (A BYO custom server would pin its own image via `mcp-custom-hosting`.)
- **In-memory, single-replica state.** The cp-executor runs one replica; the engine holds the registry + drafts + audit log + rate windows in memory. The curation/registry/quota/observability *logic* is unchanged — only where state lives differs. A Postgres-backed store on the metadata pool is the tracked follow-up.
- **Tenant scoping = registry keying + identity.** Every op uses `identity.tenantId`; `getServer(reg, tenantId, serverId)` returns null for a foreign tenant → the route surfaces 404. Quota/rate-limit decisions throw `{statusCode, code, dimension}` consumed by the existing handler.
- **Tool calls are control-plane-mediated.** `call_tool` resolves the tool in the active published manifest, enforces base + per-tool scope (the `mcp-official-server` model), and self-calls the runtime using the tool's own `method`/`path` (workspace from the credential context, never from args), returning an MCP-style result envelope (tool-level errors live in `content`, HTTP stays 200). Telemetry + an audit record are emitted via `mcp-observability`.

## Risks / Trade-offs

- *In-memory state is process-local* → acceptable for single-replica + the E2E proof; Postgres-backed durability is the follow-up. Documented.
- *Tool-call backend reachability* → a tool whose backing resource isn't provisioned returns a structured error in `content` (still a valid MCP result); the E2E proves the invoke path + audit, not specific data.

## Migration Plan

Additive + gated: no `/v1/mcp` routes exist unless `MCP_ENABLED=true`. Deploy the rebuilt cp-executor image with `MCP_ENABLED=true`. Nothing else changes; flows/data routes are untouched.

## Open Questions

- Durable (Postgres) registry + multi-replica state — the next increment.
- Whether to additionally deploy a per-tenant Knative ksvc per published server and connect to it over the MCP protocol directly (vs. the current control-plane-mediated tool calls).
