# Tasks — add-mcp-jsonrpc-protocol

## Reproduce (test-first)
- [x] Add a failing black-box test (`tests/blackbox/mcp-hosted-jsonrpc.test.mjs`) driving a published
  hosted server's `/rpc` endpoint over JSON-RPC — fails because the route does not exist.

## Implement (kind runtime AND shippable product as applicable)
- [x] Add `executeMcpRpc` to `mcp-engine.mjs`: maps `initialize`/`tools/list`/`tools/call`/`ping` (and
  JSON-RPC notifications) onto the existing engine internals; tenant/workspace credential-derived.
- [x] Register `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc` in `server.mjs` with the
  `runMcpRpc` helper (200 for a request, 202 for a notification).
- [x] Confirm the deployed `cp-executor` image already serves `/v1/mcp/*` via the gateway — no APISIX
  or `deploy/kind` change required.

## Verify
- [x] Black-box suite green: new suite (8 tests) + existing `platform-mcp-http` and
  `mcp-tool-call-execution` suites still pass.
- [x] Acceptance: a standard MCP client `initialize`s, `tools/list`s (with inputSchema), and
  `tools/call`s a hosted tool; cross-tenant lookup is rejected without leaking metadata.

## Archive
- [ ] `openspec validate add-mcp-jsonrpc-protocol --strict`; `/opsx:archive add-mcp-jsonrpc-protocol` after merge.
