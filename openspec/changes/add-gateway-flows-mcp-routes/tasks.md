# Tasks — add-gateway-flows-mcp-routes

## Status: SUPERSEDED by #560 (no code change)
- [x] Verified `/v1/flows/*` (route `2017-flows`) and `/v1/mcp/*` (route `2018-mcp`) already exist in `deploy/kind/apisix/apisix.yaml`, routing to `falcone-cp-executor` above the `/v1/*` catch-all — landed by the archived change `add-apisix-flows-mcp-routes` (#560).
- [x] Confirmed `/v1/websockets/*` has no handler anywhere in the codebase: realtime is SSE (route `2016-rt`, `/changes`), not WebSockets — a genuinely-absent transport, not a gateway gap.
- [x] Recorded the corrected scope in `proposal.md`; close GitHub issue #609 as superseded by #560 (do NOT archive a no-op spec delta — withdraw this change instead).

## Archive
- [ ] Withdraw/cancel this change (it duplicates archived #560); no spec delta to sync.
