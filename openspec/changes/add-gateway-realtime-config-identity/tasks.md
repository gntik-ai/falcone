# Tasks — add-gateway-realtime-config-identity

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: superadmin JWT -> `GET /v1/realtime/workspaces/{ws}/pg-captures` -> 401 'missing identity headers'; trust-header direct -> 401 'Missing or invalid Bearer token'; the realtime change-stream (a different, wired route) works.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Wire the APISIX identity-injection plugin for `/v1/realtime/*` (captures) and `/v1/admin/config/*`, mirroring the working data-plane routes (relates to the flows/mcp gateway-route gap G3).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: `GET /v1/realtime/workspaces/{ws}/pg-captures` and `/v1/admin/config/*` return business responses for an authorized caller; cross-tenant denied.

## Archive
- [ ] `openspec validate add-gateway-realtime-config-identity --strict`; `/opsx:archive add-gateway-realtime-config-identity` after merge.
