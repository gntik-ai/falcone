# Tasks — add-gateway-flows-mcp-routes

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: `GET /v1/flows/.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: `/v1/flows/...` and `/v1/mcp/...` -> 200 via the gateway.

## Archive
- [ ] `openspec validate add-gateway-flows-mcp-routes --strict`; `/opsx:archive add-gateway-flows-mcp-routes` after merge.
