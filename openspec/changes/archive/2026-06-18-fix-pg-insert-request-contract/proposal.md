# fix-pg-insert-request-contract

## Change type
bugfix

## Capability
data-api

## Priority
P2

## Why
OpenAPI `PostgresDataInsertRequest` documents `{"row":{...}}` → 400 `PLAN_REJECTED Unknown column row`; the executor reads `values`/`changes`.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: insert `{row:{...}}` → 400; `{values:{...}}` works.

GitHub issue #571 (epic #546). Evidence: `audit/live-campaign/evidence/20-postgres-and-isolation.md`.

## What Changes
Align the handler with the contract (or vice-versa) + a contract test — `apps/control-plane` executor + OpenAPI.

## Impact
The documented body inserts a row.
