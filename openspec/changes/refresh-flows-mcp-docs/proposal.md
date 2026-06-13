## Why

Two flagship capabilities have materially advanced since the docs were last written: **Flows** (the durable workflow engine) is functionally complete, and **MCP server hosting** is now served live by the control-plane runtime (`/v1/mcp`, wired by the runtime integration). The README(s) and docs-site still describe both as "in development / in progress / not yet wired," which **overstates immaturity** for what is now delivered and **understates** the live MCP surface. The docs also lacked a complete DSL reference and concrete MCP API examples. This change refreshes status and adds code-grounded detail — strictly to the real state derived from the schemas, contracts and merged runtime, never from intent.

## What Changes

- **Status accuracy** across `README.md` + the 5 translations, the roadmap, and the flows/mcp guide + architecture pages: Flows and MCP move from "in active development / in progress" to **Preview**, with honest per-layer labels (MCP custom-image hosting and workflows-as-tools are **Experimental** — built but not on the live create path; MCP server state is in-memory single-replica).
- **New DSL reference** (`docs-site/architecture/workflow-dsl-reference.md`): every node type, task type and trigger with a valid YAML example matching `flow-definition.json`; wired into the sidebar and cross-linked from the Flows guide.
- **MCP examples**: the real `/v1/mcp` route table, an end-to-end create → curate → publish → call → audit walkthrough, and an Instant-generated tool definition — matching the runtime (`mcp-engine`) and contracts.
- **Roadmap honesty**: shipped items (Flows, MCP) presented as Preview; genuinely-future items kept as planned, including a *planned, under-evaluation, not-yet-implemented* note for object-storage / document-DB alternatives (e.g. SeaweedFS, FerretDB+DocumentDB) — the repo ships **MinIO + MongoDB** and there is no migration code, OpenSpec change, issue or branch.
- **No license-table change**: the table is already accurate (`MinIO AGPL-3.0 ⚠`, `MongoDB SSPL-1.0 ⚠`, with the SSPL §13 / AGPL §13 re-exposure note).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `workflows`: documentation refreshed — Flows labelled Preview and a complete DSL reference published.
- `mcp`: documentation refreshed — the live `/v1/mcp` management API documented with concrete examples and accurate per-layer status.

## Impact

- **Docs/READMEs only** — no code, schema or runtime behavior changes: `README.md` + `README.{es,de,fr,ru,zh}.md`, `docs-site/guide/{flows,mcp,roadmap}.md`, `docs-site/architecture/{mcp.md, workflow-dsl-reference.md (new)}`, `docs-site/.vitepress/config.mts`, `apps/mcp-server-sdk/README.md`.
- **Verified:** VitePress build is dead-link clean; `markdownlint` passes; the not-production-ready posture is preserved.
- **Out of scope:** the storage/document-DB migrations themselves (not present in the repo); any change to the licenses table.
