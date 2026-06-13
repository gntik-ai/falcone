## Why

The MCP server hosting capability (epic #386) is fully built — pure control-plane modules, internal contracts, the chart component, spikes, and the E2E suite — but the **live control-plane runtime does not serve the MCP management API**. As #402 surfaced, `apps/control-plane/src/runtime/server.mjs` serves `/v1/{postgres,mongo,events,functions,realtime,flows}` but no `/v1/mcp` routes. This change wires MCP into the runtime so the platform actually serves the MCP management API end to end and the MCP E2E suite passes on the kind cluster. It is an **integration** change: it composes the existing reviewed modules, it does not reimplement them.

## What Changes

- **Routes**: `apps/control-plane/src/runtime/server.mjs` serves `/v1/mcp/workspaces/{ws}/servers` (`GET`/`POST`), `…/servers/{id}` (`GET`/`DELETE`), `…/{id}/curations` (`POST`), `…/{id}/versions` (`POST`), `…/{id}/versions/{v}/approval` (`POST`), `…/{id}/tool-calls` (`POST`), `…/{id}/audit` (`GET`) — registered only when an `mcpEngine` is injected, exactly like the `flowExecutor` pattern.
- **Engine**: a new integration module `apps/control-plane/src/runtime/mcp-engine.mjs` composes the existing pure modules (`mcp-instant-generator`/`mcp-official-catalog` → `mcp-curation` → `mcp-registry` → `mcp-quota` → `mcp-observability` → `mcp-official-server`) over an in-memory per-tenant store (the cp-executor runs single-replica). Platform-served servers pin the platform MCP runtime image digest so the registry's digest requirement is honored unchanged.
- **Config**: `main.mjs` injects `createMcpEngine()` when `MCP_ENABLED=true`.
- **Tenancy**: every operation is keyed by the credential-derived `identity.tenantId` (the same `resolveIdentity` header path as every route); the registry accessors reject cross-tenant reads, so a cross-tenant `get/list/call/audit` resolves to 404/empty. Quota/rate-limit breaches throw `{statusCode:429, code, dimension}` — surfaced by the runtime's existing error handler.
- **E2E**: the `tests/e2e/specs/mcp/` suite (full loop, cross-tenant, version-pinning) now runs the real loop; two minimal spec fixes make them exercise a real curated tool and a real curation-driven version bump.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: the control-plane runtime now serves the MCP management API (create → curate → publish → approve → call → observe), tenant-scoped and quota/rate-limit enforced, composing the existing MCP modules. Closes the wiring gap #402 identified.

## Impact

- **control-plane runtime:** `runtime/mcp-engine.mjs` (new integration engine) + `runtime/server.mjs` (routes + `runMcp` helper, gated on `mcpEngine`) + `main.mjs` (injection on `MCP_ENABLED`). No new dependencies. The cp-executor image gains the `/v1/mcp` surface.
- **State model:** in-memory, single-replica (a Postgres-backed store on the metadata pool is the tracked follow-up, mirroring how flows began). No contract changed.
- **Verified:** unit tests for the engine; the full MCP E2E suite passes against the **kind cluster** (real run, evidence under `spikes/add-mcp-control-plane-runtime/evidence/kind-e2e-run.txt`).
- **Out of scope:** a Postgres-backed registry; deploying a per-tenant Knative ksvc per server (the engine mediates tool-calls through the control-plane); changing any reviewed module contract.
