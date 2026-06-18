# Tasks — add-platform-mcp-http-route

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: no HTTP route serves the platform MCP; MCP hosting + MCP->workflow otherwise work.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Register an HTTP route for the platform MCP server (tenant-scoped).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An MCP client connects to the platform MCP and manages projects/resources, tenant-scoped.

## Archive
- [ ] `openspec validate add-platform-mcp-http-route --strict`; `/opsx:archive add-platform-mcp-http-route` after merge.
