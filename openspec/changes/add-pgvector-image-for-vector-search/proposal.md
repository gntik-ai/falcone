# add-pgvector-image-for-vector-search

## Change type
enhancement

## Capability
data-api

## Priority
P2

## Why
`CREATE EXTENSION vector` fails with 'extension vector is not available' on the deployed bitnami Postgres; the chart ships a `pgvector/pgvector` image (operator contract) but the kind/campaign profile uses bitnami, so vector/KNN search is unavailable. (Initially mis-reported as not-deployed; the chart DOES support it.)

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: direct `CREATE EXTENSION IF NOT EXISTS vector` on `wsdb_acme_app_staging` -> ERROR extension not available; chart `values.yaml` documents `pgvector/pgvector` as the vector-capable image.

GitHub epic E. Evidence: `audit/live-campaign/evidence-rerun/12-pg-mongo-data-and-direct.md`.

## What Changes
Use the `pgvector/pgvector` image for the shared (or dedicated) Postgres in profiles that must support vector search; verify `CREATE EXTENSION vector` + a KNN query through the data API.

## Impact
A workspace creates the vector extension and runs a KNN similarity query.
