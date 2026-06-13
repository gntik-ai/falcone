## Why

Tenants need to learn Instant MCP, custom hosting, and connecting clients; operators need the internal architecture + a runbook. The documentation must be code-grounded and live in the VitePress docs-site, mirroring the Flows docs. This resolves issue **#403** (epic #386) and documents the whole set (#387 … #402) — the final change in the epic.

## What Changes

- **Tenant guide** `docs-site/guide/mcp.md` — Instant MCP / custom / official sources, mandatory curation, connecting clients (Cursor deeplink + Claude Code / claude.ai / VS Code snippets), the Playground, the Server SDK, the CLI, flows-as-tools, version-pinning, quotas/limits, isolation.
- **Internal architecture** `docs-site/architecture/mcp.md` — component map, Knative runtime, APISIX gateway, Keycloak OAuth AS, curation/registry/supply-chain, tenancy/isolation/quotas, observability, flows-as-tools, and an honest **status & maturity** note (the control-plane HTTP wiring is the remaining integration).
- **Operational runbook** `docs-site/architecture/mcp-runbook.md` — deploy & enable (`mcp.enabled`), NetworkPolicy + CNI caveat, OAuth AS, supply-chain, quotas, scale-to-zero, observability, the E2E suite, the pending wiring, and a failure-mode table.
- **Nav/sidebar** updated (`.vitepress/config.mts`) and cross-linked to **ADR-12** (#387).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add the **documentation** — tenant guide, internal architecture, and operational runbook in the VitePress docs-site, cross-linked to ADR-12, covering #387 … #402. Documentation-only.

## Impact

- **docs-site:** `guide/mcp.md`, `architecture/mcp.md`, `architecture/mcp-runbook.md`, `.vitepress/config.mts` (sidebar). VitePress build is green with no dead links (verified).
- **Honesty:** the docs are code-grounded and state the live-vs-designed status explicitly (the control-plane MCP management routes are not yet served — the remaining integration), so the guide does not overclaim.
- **Out of scope:** marketing copy; the README (separate).
