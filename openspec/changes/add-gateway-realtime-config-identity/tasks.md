# Tasks — add-gateway-realtime-config-identity

## Reproduce (test-first)
- [x] Failing black-box probes reproducing the defect: `tests/blackbox/cdc-capture-verify-jwt-identity.test.mjs` (bbx-611-pg-list-path-workspace) — pg-capture-list returned 401 for a tenant-scoped caller with the workspace only in the path; product test `tenant-config-format-versions` (200 for a superadmin with no own-tenant claim) — was 401. (Live: superadmin JWT -> `GET /v1/realtime/workspaces/{ws}/pg-captures` -> 401 'missing identity headers'.)
- [x] Corrected the proposal's root cause: identity-injection is NOT an APISIX gap (the control-plane derives trusted headers from the verified JWT). The defects are in the actions.

## Implement (kind runtime AND shippable product as applicable)
- [x] `pg-capture-list` (`services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs`) addresses the workspace by URL path (`params.workspaceId`), tenant from the trusted `x-tenant-id` header only; repo read stays tenant-scoped. (Single product action loaded by both the kind CP `/repo` loader and the product runtime — no dual edit needed.)
- [x] `parseConfigIdentity` (`tenant-config-identity.mjs`) gains `requireTenant` (default true → all existing tenant-scoped config actions unchanged); returns null when there is no trusted identity at all (anti-spoofing preserved).
- [x] `tenant-config-format-versions` + `tenant-config-export-domains` call `parseConfigIdentity({requireTenant:false})` and authorize a platform operator (superadmin/sre) or the `platform:admin:config:export` scope.
- [x] No APISIX route change required (flows/mcp routes already exist via archived #560; realtime/admin-config reach the CP via the `/v1/*` catch-all).

## Verify
- [x] Black-box suite green: `tenant-config-verify-role-claims` (anti-spoofing invariant, 13/13), `cdc-capture-verify-jwt-identity` (incl. 3 new #611 cases, 9/9); product `tenant-config-format-versions` (4/4) and `tenant-config-export-domains` (7/7) green; fixed two stale unit tests to the correct 401 semantics.
- [ ] Live 2-tenant probe on the re-stood-up kind cluster: superadmin `GET /v1/admin/config/format-versions` -> 200; tenant_owner `GET /v1/realtime/workspaces/{ws}/pg-captures` -> 200; cross-tenant -> empty/denied.
- [x] Acceptance encoded as scenarios in the spec delta.

## Archive
- [ ] `openspec validate add-gateway-realtime-config-identity --strict`; `/opsx:archive add-gateway-realtime-config-identity` after live verification + merge.
