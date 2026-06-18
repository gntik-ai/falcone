# fix-pg-browse-tenant-scope

## Change type
bugfix

## Capability
tenant-isolation

## Priority
P1

## Why
`GET /v1/postgres/databases` scans `pg_database` cluster-wide → lists every tenant's `wsdb_*` databases AND the platform control DB `in_falcone`; schemas/tables/columns are then enumerable cross-tenant. (Row DATA stays RLS-protected; this is a metadata/structure leak.)

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** `acme-ops` → `GET /v1/postgres/databases` shows globex DBs + `in_falcone` (23 internal tables); `.../{globexDb}/schemas|tables|columns` → 200. Root: `pg-handlers.mjs::pgListDatabases` + browse handlers filter by neither `tenant_id` nor `workspace_databases`.

GitHub issue #551 (epic #539). Evidence: `audit/live-campaign/evidence/20-postgres-and-isolation.md`.

## What Changes
Restrict the database list to `workspace_databases` rows owned by the caller's tenant; reject browse on non-owned DBs; never expose `in_falcone` — kind `pg-handlers.mjs` + product handler.

## Impact
acme sees only acme's DBs; globex/internal DBs hidden; live probe.
