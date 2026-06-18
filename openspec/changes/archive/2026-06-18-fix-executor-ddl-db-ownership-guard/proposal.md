# fix-executor-ddl-db-ownership-guard

## Change type
bugfix

## Capability
data-api

## Priority
P1

## Why
The executor DDL path executes against the literal URL `{db}` without checking it belongs to the caller's workspace/tenant. Via the gateway-BYPASS trust-header path (no workspace; `GATEWAY_SHARED_SECRET` unset on the executor) this reaches the platform control DB `in_falcone`. The tenant-facing apiKey path IS confined (no tenant-to-tenant leak).

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Trust-header `POST /v1/postgres/databases/in_falcone/schemas` -> schema created in `in_falcone` (verified). ApiKey path targeting `in_falcone`/globex lands in the caller's OWN ws DB (no leak). `apps/control-plane/src/runtime/postgres-ddl-executor.mjs`.

GitHub epic B. Evidence: `audit/live-campaign/evidence-rerun/12-pg-mongo-data-and-direct.md`.

## What Changes
Resolve/validate the target DB against the caller's workspace ownership; reject `in_falcone` and non-owned DBs (fail-closed); set `GATEWAY_SHARED_SECRET` on the executor so it does not openly honor trust headers.

## Impact
DDL on a non-owned DB or `in_falcone` -> 403; own-workspace DDL unaffected; the executor rejects unsigned trust headers.
