## Context

The docs-site mirrors the Flows docs trio precedent (guide + architecture + runbook) and the README carries the not-production-ready notice, the BaAIS positioning, the roadmap, and the third-party-licenses table. The original flows/mcp docs were written before the capabilities reached their current state, so their status labels and examples drifted from the code. The cardinal constraint for this refresh: **status and examples are derived from the code/schema/contracts, never from intent** — a wrong example (DSL that doesn't validate, an endpoint that doesn't exist) is worse than no example.

## Goals / Non-Goals

**Goals:** correct the delivered status of Flows + MCP across all READMEs and docs; add a complete, schema-valid DSL reference and concrete MCP API examples; keep genuinely-future work in the roadmap; preserve the not-production-ready posture.

**Non-Goals:** implementing or claiming the storage/document-DB migrations (no artifacts exist); changing the licenses table; any code/schema change.

## Decisions

- **Verify per feature from the code.** Flows: `flow-definition.json` (DSL), `/v1/flows` runtime routes, the interpreter worker, the archived `workflows` spec → **Preview**. MCP: `/v1/mcp` + `mcp-engine` on `main` (runtime wiring merged); `draftForSource` wires `instant` + `official` → **Preview**; `mcp-custom-hosting` + `mcp-workflows-tools` exist but are not on the live create path → **Experimental**; engine state is in-memory → noted. Storage: `git grep` across all branches/OpenSpec/issues/PRs for SeaweedFS/FerretDB/DocumentDB = 0 → **planned, under evaluation**, MinIO + MongoDB documented as current.
- **DSL reference, not duplication.** The Flows guide already documents node/task/trigger types with valid YAML, so the new reference page is the *exhaustive* schema-derived spec (one valid YAML per node/task/trigger + the full document shape + publish/run), cross-linked from the guide — the guide stays the narrative.
- **MCP examples match the runtime.** The route table and the create→curate→publish→call→audit curl flow are taken from `runtime/server.mjs` + `runtime/mcp-engine.mjs`; the example tool definition mirrors the Instant generator's output shape.
- **Honest per-layer labels.** Each MCP layer carries an explicit status (Preview vs Experimental); the roadmap separates "Shipped (Preview)" from "In progress / planned."
- **OpenSpec framing.** This is a documentation refresh; the spec delta records the documentation guarantees (DSL reference exists, status is accurate, MCP live-API examples exist, roadmap distinguishes shipped from planned) as requirements on the `workflows` and `mcp` capabilities.

## Risks / Trade-offs

- *Docs describe Preview, not production* → mitigated by preserving the top-level not-production-ready warning and per-feature Preview/Experimental labels.
- *Translations* → status prose translated into 5 languages; component names, SPDX ids, `/v1/mcp` and epic links kept verbatim.

## Migration Plan

Additive/edit-in-place documentation change. No data, schema or runtime migration.

## Open Questions

- None. If the storage/document-DB migrations land (or live in another repo), the roadmap "planned" note is replaced with real status in a follow-up.
