## 1. Tenant guide

- [x] 1.1 `docs-site/guide/mcp.md` — sources (Instant/custom/official), mandatory curation, connecting clients (Cursor deeplink + Claude Code/claude.ai/VS Code snippets), Playground, Server SDK, CLI, flows-as-tools, version-pinning, quotas/limits, isolation; status note + ADR-12/architecture cross-links

## 2. Internal architecture + runbook

- [x] 2.1 `docs-site/architecture/mcp.md` — component map, Knative runtime, APISIX gateway, Keycloak OAuth AS, curation/registry/supply-chain, tenancy/isolation/quotas, observability, flows-as-tools, honest status & maturity
- [x] 2.2 `docs-site/architecture/mcp-runbook.md` — deploy & enable, NetworkPolicy + CNI caveat, OAuth AS, supply-chain, quotas, scale-to-zero, observability, E2E suite, pending integration, failure-mode table

## 3. Nav + cross-links + build

- [x] 3.1 `.vitepress/config.mts` — add MCP guide to Getting Started; MCP Architecture + MCP Runbook to Architecture; cross-link ADR-12 (#387)
- [x] 3.2 `vitepress build` green — no dead links (verified); `openspec validate --strict` + `pnpm lint` pass

## 4. Finalize

- [x] 4.1 Docs are code-grounded and state the live-vs-designed status (control-plane MCP route wiring is the remaining integration) so the guide does not overclaim
