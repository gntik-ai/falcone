## Context

The platform's management surface is the `structural_admin` (36) + `data_access` (21) routes in `services/gateway-config/public-route-catalog.json`. The first-party MCP server exposes a **curated subset** of these as MCP tools so a tenant can drive their project from an MCP client, under the same credential-derived tenant model (ADR-2), OAuth (#390), gateway (#389) and runtime (#388) as everything else.

## Goals / Non-Goals

**Goals:** a read-first curated tool catalog with LLM-optimized descriptions; explicit per-tool scopes on every mutating tool; a server that refuses a mutating call without its scope.

**Non-Goals:** auto-generating tools from tenant resources (#392, Instant MCP); custom servers (#394); the Connect UX (#397); the Server SDK package (#401) — here the control-plane client is injected.

## Decisions

- **Curated, not generated.** Hand-pick the genuinely useful management operations and write good descriptions, rather than emit one tool per route. Rationale: auto-dumped tools degrade LLM tool-call quality (the same reason Instant MCP #392 mandates curation).
- **Read-first.** Read tools (mapped to `GET`) need only the base `mcp:invoke` scope and are always callable. Mutating tools (`POST/PUT/DELETE`) are **listed** (so the agent can discover them) but each `tools/call` is **refused unless** the tool's explicit scope (`mcp:falcone:<area>:write`) is in the caller's granted scopes. This makes the safe path the default and mutations deliberate.
- **Injected control-plane client.** Tool handlers call `callFalcone(method, path, body)` — injected, so the catalog/server is unit-testable with fakes and will later be backed by the Server SDK (#401) with tenant-scoped clients. The tenant is never taken from tool arguments.
- **Co-locate in the control-plane for now.** The catalog + handler ship as modules in `apps/control-plane/src/` (a first-party component, no new workspace package / service-map entry); extractable to a standalone deployable image when the runtime packaging lands.

## Risks / Trade-offs

- *Scope sprawl / stale catalog* → keep the catalog small and curated; a contract test guards that every mutating tool has a scope and every tool has a description.
- *Catalog drift from the route catalog* → tools reference real `method`+`path`; future work can validate them against `public-route-catalog.json`.

## Migration Plan

Additive: new modules + tests, no change to existing control-plane behavior. The server is wired into the runtime/gateway when MCP hosting is enabled for the tenant.

## Open Questions

- Final tool list (which operations are "genuinely useful") — start with a small read-first set + the most common mutations; refine with usage.
- Whether to validate the catalog against `public-route-catalog.json` in CI (nice-to-have).
