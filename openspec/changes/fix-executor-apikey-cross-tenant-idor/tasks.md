# Tasks — fix-executor-apikey-cross-tenant-idor

## Pre-implementation (test-first)
- [ ] Write a failing black-box test: `POST /v1/workspaces/{foreign-ws}/api-keys` with a caller from a different tenant → assert 403 `CROSS_TENANT_VIOLATION`.
- [ ] Confirm the test fails against the current build (reproduces the IDOR).

## Implementation
- [ ] In the executor api-key issuance handler, resolve the owning `tenant_id` for `{workspaceId}` from the workspace store / control-plane lookup.
- [ ] Compare resolved `owning_tenant_id` to the verified `tenant_id` from the caller's JWT.
- [ ] If they differ, return 403 with body `{ "code": "CROSS_TENANT_VIOLATION", "message": "Workspace does not belong to the caller's tenant" }`.
- [ ] Audit all other `{workspaceId}`-bearing admin routes in the executor for the same missing check; apply the same ownership guard.

## Verification
- [ ] Run `bash tests/blackbox/run.sh` — own-ws issuance (201) and foreign-ws issuance (403) both pass.
- [ ] Add cross-tenant probe to `tests/e2e/fixtures/isolation.js` (two-tenant fixture).
- [ ] Run `/opsx:verify fix-executor-apikey-cross-tenant-idor`.

## Archive
- [ ] `/opsx:archive fix-executor-apikey-cross-tenant-idor`
