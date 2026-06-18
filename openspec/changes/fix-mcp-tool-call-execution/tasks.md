# Tasks — fix-mcp-tool-call-execution

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: create+publish an instant server → call a tool → returns the executor index JSON, not tool data.

## Implement (kind runtime AND shippable product)
- [ ] Set `MCP_SELF_BASE_URL`, fix the instant tool request templates, and route official/platform tools to the control-plane — `apps/control-plane` mcp-engine + deploy env.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A hosted tool-call performs the real action and returns its result.

## Archive
- [ ] `openspec validate fix-mcp-tool-call-execution --strict`; `/opsx:archive fix-mcp-tool-call-execution` after merge.
