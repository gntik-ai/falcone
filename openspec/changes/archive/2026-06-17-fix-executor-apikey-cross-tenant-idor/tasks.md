# Tasks — fix-executor-apikey-cross-tenant-idor

## Pre-implementation (test-first)
- [x] Write a failing black-box test: `POST /v1/workspaces/{foreign-ws}/api-keys` with a caller from a different tenant → assert 403 `CROSS_TENANT_VIOLATION`. (`tests/blackbox/executor-apikey-cross-tenant-idor.test.mjs`)
- [x] Confirm the test fails against the current build (reproduces the IDOR). (cross-tenant POST → 201, list → 200 before the fix)

## Implementation
- [x] In the executor request dispatch, resolve the owning `tenant_id` for `{workspaceId}` from the workspace store. (`createWorkspaceTenantResolver` → `workspace_databases.tenant_id`, `apps/control-plane/src/runtime/workspace-dsn-resolver.mjs`)
- [x] Compare resolved `owning_tenant_id` to the verified `tenant_id` from the caller's identity. (`apps/control-plane/src/runtime/server.mjs`, guard after the credential-binding check)
- [x] If they differ, return 403 with body `{ "code": "CROSS_TENANT_VIOLATION", "message": "Workspace does not belong to the caller's tenant" }`.
- [x] Audit all other `{workspaceId}`-bearing admin routes in the executor for the same missing check; apply the same ownership guard. (Implemented once centrally in the dispatch — covers every `/…/workspaces/{id}/…` route, incl. api-keys list/rotate/revoke, data, events, functions, mongo, realtime, embedding-provider. Workspace-bound credentials remain covered by the pre-existing binding check; the new guard additionally neutralises any already-issued cross-tenant key at use time.)

## Verification
- [x] Run `bash tests/blackbox/run.sh` — own-ws issuance (201) and foreign-ws issuance (403) both pass. (636/636 black-box tests green)
- [x] Add a cross-tenant probe to the real-stack E2E (the repo's per-issue convention, not the non-existent `tests/e2e/fixtures/isolation.js`): `tests/e2e/issues/fix-executor-apikey-cross-tenant-idor.realstack.test.mjs` — drives the real executor HTTP server against the live `workspace_databases` registry on tests/env Postgres. 3/3 green.
- [x] Regression: existing `tests/env/executor` HTTP + api-keys-RLS suites unchanged (17/17 green); related unit + gateway-apikey contract suites green.
- [x] Run `/opsx:verify fix-executor-apikey-cross-tenant-idor`. (No critical/warning issues; 3/3 scenarios covered.)

## Archive
- [x] `/opsx:archive fix-executor-apikey-cross-tenant-idor`. (Delta synced into `openspec/specs/tenant-isolation/spec.md` as an ADDED requirement.)
