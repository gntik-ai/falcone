## Context

A tenant's resources are already reachable through the platform's RLS-bound data path (executor over adapter-built plans, ADR-4; RLS + tenant predicate, ADR-1) and the public data_access routes (`/v1/postgres/workspaces/{ws}/data/...`, `/v1/functions/{id}/invoke`, `/v1/objects/{bucket}/{key}`, `/v1/events/{publish,subscribe}`). Instant MCP maps those resources to MCP tools. The proven constraint (the same one the official server #391 honors) is that raw, auto-dumped tools degrade LLM tool-call quality — so generation produces a **draft** that must be curated (#393).

## Goals / Non-Goals

**Goals:** extensible per-resource generators; a deterministic draft manifest with LLM-oriented descriptions, input schemas, mutation flags and suggested scopes; an explicit "requires curation, never auto-published" contract.

**Non-Goals:** the curation UX/publish gate (#393); executing the tools (rides the executor); custom servers (#394); choosing the *final* tool set (curation does).

## Decisions

- **Extensible generator registry.** `GENERATORS = { postgres, functions, storage, events }`, each `(serverId, resource) => McpTool[]`. New resource types (e.g. mongo, vector) plug in without touching the dispatcher. *Alternative:* one monolithic generator — rejected (not extensible).
- **Generate draft, never publish.** `generateInstantManifest` returns `{ status: 'draft', requiresCuration: true, tools }`. The publish gate lives in curation (#393); this module cannot produce a "published" manifest. Rationale: makes "raw dump can't reach an LLM" true by construction.
- **Map to RLS-bound operations.** Generated query tools target the data-API routes, so execution goes through the executor under RLS (tenant-scoped) — the generator never invents a bypass path. Mutating tools (insert/put/delete/publish) get `mutates: true` + a suggested `mcp:<server>:write:<resource>` scope (curation finalizes scopes).
- **Deterministic + idempotent.** Stable tool ordering and names so re-generation diffs cleanly against the curated set (supports re-sync on schema change).

## Risks / Trade-offs

- *Over-generation (one tool per table × CRUD)* → curation (#393) prunes; the generator intentionally emits a conservative set (read + insert per table, not full CRUD) to keep the draft small.
- *Column-type → JSON-schema fidelity* → a pragmatic type map (text/number/boolean/object); unknown types fall back to string. Good enough for a draft a human curates.

## Migration Plan

Additive: pure generator modules + tests, no runtime change. Wired in when a tenant toggles Instant MCP; output flows to curation (#393).

## Open Questions

- Whether to also generate `update_/delete_<table>` tools — deferred; start read + insert, let curation request more.
- Mongo/vector generators — future resource types via the same registry.
