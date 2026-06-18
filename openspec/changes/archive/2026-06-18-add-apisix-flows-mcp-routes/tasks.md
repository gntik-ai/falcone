# Tasks — add-apisix-flows-mcp-routes

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: `GET /v1/flows/.../task-types` and `/v1/mcp/.../servers` → 404 NO_ROUTE at the gateway. — `tests/blackbox/apisix-flows-mcp-routes.test.mjs` (bbx-560-01..04): parsed `deploy/kind/apisix/apisix.yaml` and asserted NO `/v1/flows/*` or `/v1/mcp/*` route to the executor upstream (failing pre-fix).

## Implement (kind runtime AND shippable product)
- [x] Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes (standalone APISIX config + gateway-config). — `deploy/kind/apisix/apisix.yaml` adds routes `2017-flows` (`/v1/flows/*`, priority 245) and `2018-mcp` (`/v1/mcp/*`, priority 244), both → `falcone-cp-executor` with the same gateway-trust idiom as the existing executor routes (strip x-tenant-id/x-workspace-id/x-auth-subject/x-actor-roles, inject `x-gateway-auth: ${{GATEWAY_SHARED_SECRET}}`; the executor verifies the Bearer JWT itself). Both outrank the `/v1/*` catch-all (id 5000, priority 50). Source-of-truth: flows paths were already in `services/gateway-config/public-route-catalog.json`; added the MCP servers management paths (`GET`/`POST /v1/mcp/workspaces/{workspaceId}/servers`, `GET`/`DELETE .../servers/{serverId}`) as `structural_admin` for parity.
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable. — The flows/mcp handlers already exist in `apps/control-plane/src/runtime/server.mjs` (executor); only the gateway routing was missing. Updated the gateway-config catalog (above); no runtime handler change needed.

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes. — `bash tests/blackbox/run.sh` → 834/834 pass. `apisix.yaml` re-parsed as valid YAML (31 routes) and the catalog as valid JSON.
- [x] Acceptance: `GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` → 200 via the gateway. — Both prefixes now route to the executor (which serves them) above the control-plane catch-all, so they no longer 404 NO_ROUTE at the gateway.

## Archive
- [ ] `openspec validate add-apisix-flows-mcp-routes --strict`; `/opsx:archive add-apisix-flows-mcp-routes` after merge. (validate run in this session; archive deferred to the batching orchestrator.)
