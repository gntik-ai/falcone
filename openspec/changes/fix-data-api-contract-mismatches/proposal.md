# fix-data-api-contract-mismatches

## Change type
bugfix

## Capability
data-api

## Priority
P2

## Why
Mongo db-provision needs body `name` not `databaseName` (400); executor function deploy `{source:{inlineCode}}` fails at invoke (source object not unwrapped); route-catalog bulk path `.../bulk/insert` vs executor `.../rows/bulk/insert`; apikey list snake_case vs mint camelCase.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: each mismatch reproduced against the executor (400 / invoke error / 404 / inconsistent JSON).

GitHub epic E. Evidence: `audit/live-campaign/evidence-rerun/12-pg-mongo-data-and-direct.md`.

## What Changes
Align the handlers with the OpenAPI-documented shapes (or correct the catalog/docs) + contract tests.

## Impact
The documented shapes work; the catalog path resolves; response casing is consistent.
