# Tasks — add-mcp-jsonrpc-protocol

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: tool list/call work through the internal API; no JSON-RPC/Streamable-HTTP endpoint for a standard client.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Expose the MCP protocol surface so a standard MCP client can list+call tools.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A standard MCP client lists and calls a hosted tool over the protocol.

## Archive
- [ ] `openspec validate add-mcp-jsonrpc-protocol --strict`; `/opsx:archive add-mcp-jsonrpc-protocol` after merge.
