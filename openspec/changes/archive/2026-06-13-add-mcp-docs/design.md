## Context

The Flows docs are the precedent: a tenant guide (`docs-site/guide/flows.md`), an internal
architecture doc (`docs-site/architecture/flows.md`), and an operational runbook
(`docs-site/architecture/flows-runbook.md`), all linked from `.vitepress/config.mts` and cross-linked
to the relevant ADR. The MCP docs mirror that trio exactly. ADR-12 already records the MCP hosting
decision in `docs-site/architecture/adrs.md`.

## Goals / Non-Goals

**Goals:** a code-grounded tenant guide, internal architecture doc, and runbook; nav/sidebar wiring;
ADR-12 cross-links; a green VitePress build with no dead links; an honest status note.

**Non-Goals:** marketing copy; the README; changing any product behavior (docs-only).

## Decisions

- **Mirror the Flows trio.** Same three files, same headings style (route/feature tables, ASCII
  component map, cross-links), same sidebar groups. ADR cross-links use the same
  `/architecture/adrs#adr-NN-…` form the Flows docs use.
- **Code-grounded, not aspirational.** Every claim maps to a merged artifact (the `mcp-*.mjs`
  modules, the chart component, the contracts, the CLI, the SDK, the E2E suite). Snippets are the
  real shapes (Cursor deeplink, `.mcp.json`, the SDK `ctx.db.select` example).
- **State the maturity honestly.** A status note in the guide and architecture doc, and a "pending
  integration" section in the runbook, record that the control-plane runtime does not yet serve
  `/v1/mcp/...` (the modules are pure) — so the docs describe the intended product surface without
  overclaiming, and point at the wiring follow-up.
- **Verify the build.** `vitepress build` validates internal links (dead links fail the build); the
  build is green. Fragment anchors follow the existing Flows-docs convention.

## Risks / Trade-offs

- *Docs describe a surface not yet fully served live* → mitigated by the explicit status/pending
  notes; the guide is framed as the product surface, with maturity called out.

## Migration Plan

Additive: three Markdown pages + sidebar entries. No code or behavior changes.

## Open Questions

- None blocking. When the control-plane MCP routes are wired, the status notes are removed.
