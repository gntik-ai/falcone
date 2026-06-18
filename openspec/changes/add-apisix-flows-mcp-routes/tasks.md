# Tasks — add-apisix-flows-mcp-routes

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: `GET /v1/flows/.

## Implement (kind runtime AND shippable product)
- [ ] Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes (standalone APISIX config + gateway-config).
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: `GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` → 200 via the gateway.

## Archive
- [ ] `openspec validate add-apisix-flows-mcp-routes --strict`; `/opsx:archive add-apisix-flows-mcp-routes` after merge.
