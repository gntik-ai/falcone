# Tasks — add-platform-mcp-http-route

## Reproduce (test-first)
- [x] Failing black-box probe: `tests/blackbox/platform-mcp-http.test.mjs` drives `POST /v1/mcp/rpc` (initialize / tools/list / tools/call) against `createControlPlaneServer` + a fake control-plane upstream — the route did not exist before this change. (Live: no HTTP route serves the platform MCP; MCP hosting + MCP->workflow otherwise work.)

## Implement (kind runtime AND shippable product as applicable)
- [x] Register `POST /v1/mcp/rpc` on the executor (`apps/control-plane/src/runtime/server.mjs`), gated on a configured control-plane upstream. It dispatches the JSON-RPC message to the first-party handler (`mcp-official-server.mjs::handleMcpMessage`) with a `callFalcone` client bound to the caller's bearer + upstream, and grantedScopes from the verified identity. (The executor image is built from `apps/control-plane/Dockerfile`, so this covers the kind runtime; the gateway already routes `/v1/mcp/*` → executor via route `2018-mcp`, so no APISIX change is needed.)
- [x] Thread the caller `authorization` header into the request context so `callFalcone` forwards the only credential the control-plane accepts.
- [x] `identityFromHeaders` now parses `x-actor-scopes` (gateway-injected) so scope-gated handlers authorize on the trust-header path too.

## Verify
- [x] Black-box suite green: `platform-mcp-http` (5/5) — initialize, tools/list, read-tool proxy + bearer forwarding, mutating-scope refusal (no upstream call), unauthenticated 401.
- [ ] Live: an MCP client `initialize` + `tools/list` against `/v1/mcp/rpc` via the gateway on the re-stood-up kind cluster (tools/call requires a token carrying `mcp:invoke`).
- [x] Acceptance encoded as scenarios in the spec delta.

## Archive
- [ ] `openspec validate add-platform-mcp-http-route --strict`; `/opsx:archive add-platform-mcp-http-route` after live verification + merge.
