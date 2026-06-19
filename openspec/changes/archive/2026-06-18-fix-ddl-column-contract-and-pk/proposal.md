# fix-ddl-column-contract-and-pk

## Change type
bugfix

## Capability
data-api

## Priority
P2

## Why
Create-table requires `columnName/dataType` (not the documented `name/type`), and `primaryKey:true` emits no PK constraint (tables become unusable for by-PK CRUD).

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: `columns:[{name,type}]` -> 400 DDL_INVALID; `primaryKey:true` creates no `pg_index` entry. `postgresql-structural-admin.mjs` / `postgres-ddl-executor.mjs`.

GitHub epic E. Evidence: `audit/live-campaign/evidence-rerun/12-pg-mongo-data-and-direct.md`.

## What Changes
Accept the documented `name/type` shape (or fix the OpenAPI), and emit a PRIMARY KEY constraint when `primaryKey:true`.

## Impact
The documented create-table body works and `primaryKey` creates a usable PK.
