# Tasks — fix-executor-ddl-db-ownership-guard

## Reproduce (test-first)
- [x] `tests/blackbox/executor-ddl-db-ownership-guard.test.mjs` — fails on old code: trust-header DDL reaches `in_falcone` / a foreign workspace; the `routed`-based guard and the identity.workspaceId ownership fallback do not exist.

## Implement (kind runtime AND shippable product as applicable)
- [x] `workspace-dsn-resolver.mjs`: `resolveConnection` returns `routed` (true only for a dedicated wsdb_*, false on platform/base fallback).
- [x] `connection-registry.mjs`: `withAdminClient(ws, fn, { requireDedicatedDatabase })` fails closed 403 `DDL_TARGET_DB_FORBIDDEN` when `routed === false`; `failClosed` takes a statusCode.
- [x] `postgres-ddl-executor.mjs`: passes `requireDedicatedDatabase: true` → DDL never runs on the shared platform DB.
- [x] `server.mjs`: dispatch cross-tenant ownership check falls back to `identity.workspaceId` (covers DDL routes with no `/workspaces/` segment).
- [x] `deploy/kind/executor-demo.yaml`: set `GATEWAY_SHARED_SECRET` from the chart secret `in-falcone-gateway-shared-secret` (APISIX already injects the matching `x-gateway-auth`). Chart executor wiring already covered by the gateway-shared-secret suite.

## Verify
- [x] `node --test tests/blackbox/executor-ddl-db-ownership-guard.test.mjs` green; DDL/executor regressions (reprovision-ddl, vector-search-ddl, apikey-cross-tenant-idor, credential-binding, table-isolation) unaffected.
- [x] Acceptance: DDL on a non-owned DB or `in_falcone` → 403; own-workspace DDL unaffected; the executor rejects unsigned trust headers.

## Archive
- [ ] `openspec validate fix-executor-ddl-db-ownership-guard --strict`; `/opsx:archive fix-executor-ddl-db-ownership-guard` after merge.
