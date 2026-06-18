# Tasks — add-mcp-workflow-and-platform-binding

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: no live API path creates a flow-backed MCP tool; platform MCP tool-calls return the executor index.

## Implement (kind runtime AND shippable product)
- [ ] Wire the flow-backed tool generator into the MCP engine; make the platform MCP tools call the control-plane.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An MCP tool starts a workflow and returns its result; a platform MCP tool creates a project.

## Archive
- [ ] `openspec validate add-mcp-workflow-and-platform-binding --strict`; `/opsx:archive add-mcp-workflow-and-platform-binding` after merge.
