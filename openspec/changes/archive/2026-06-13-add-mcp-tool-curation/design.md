## Context

`mcp-instant-generator` (#392) emits a draft manifest `{ status:'draft', requiresCuration:true, tools:[{name, description, inputSchema, mutates, suggestedScope, source, ...}] }` and, by construction, cannot publish. Curation is the gate that turns a draft (or any candidate tool set) into a connectable server, and is where the "prune + write good descriptions + set scopes" discipline lives.

## Goals / Non-Goals

**Goals:** pure, deterministic curation logic (enable/disable, rewrite descriptions, assign scopes), a validation pass, and a publish gate such that only published manifests are connectable.

**Non-Goals:** the React console UI (#397, web-console baseline); generation (#392); OAuth token issuance (#390) — curation only *assigns* the per-tool scope name.

## Decisions

- **Curation is a pure transform.** `applyCuration(draft, curation)` returns a new curated manifest; no I/O. Rationale: trivially testable, deterministic, and reusable by the console and by automated re-sync.
- **Publish gate enforces quality.** `publishManifest` refuses to publish if any **enabled mutating tool lacks a scope** or **zero tools are enabled** — these are exactly the failure modes that make a generated server unusable/unsafe. `isConnectable` is true only for `published`, so the #392 invariant ("draft never served") holds end-to-end.
- **Scope precedence.** A curator-assigned scope wins; otherwise the tool's `suggestedScope` (from #392) is used; a mutating tool ending with no scope is a violation. Read tools need no per-tool scope (base `mcp:invoke`).
- **Description override.** Curators may replace any tool's description; the curated description is what the published `tools/list` serves.

## Risks / Trade-offs

- *Curator disables everything* → publish refused (zero enabled tools) — a clear, early error rather than an empty connectable server.
- *Stale curation after re-generation* → the curated set is diffable against a fresh draft (#392 is deterministic); re-sync surfaces added/removed tools for re-curation (future console affordance).

## Migration Plan

Additive: pure module + tests. The console (#397) and the publish action wire to it when Instant MCP / custom servers are enabled.

## Open Questions

- Whether description rewrites should be length/quality-linted at publish (e.g., min length) — start permissive, add a soft check later.
- Re-sync UX (added/removed tools on schema change) — deferred to the console (#397).
