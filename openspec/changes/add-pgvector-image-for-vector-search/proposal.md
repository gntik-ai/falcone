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

## Status (DEFERRED — corrected scope, 2026-06-19)
Investigation against the code reclassifies this from a low-risk fix to a larger/by-design item:

- **Vector is a dedicated-DB capability by design.** `postgres-applier.mjs::_unavailableExtensionMessage`
  deliberately rejects `CREATE EXTENSION vector` on the shared bitnami instance and names the remedy
  image (`pgvector/pgvector:pgNN`); `postgresql-structural-admin.mjs` documents "pgvector is
  database-level + dedicated-DB only". The chart records `postgresql.dedicatedTenantImage:
  pgvector/pgvector:pg17` as an **operator contract** (not chart-applied) for operator-provisioned
  dedicated-DB tenants. So the live `CREATE EXTENSION vector` failure on a shared-instance workspace
  DB is **working-as-designed**, with an actionable error — not a defect.
- **Force-swapping the shared image is high-risk.** The bundled Postgres uses the **bitnami env
  contract** (`POSTGRESQL_USERNAME`/`POSTGRESQL_PASSWORD`/`POSTGRESQL_POSTGRES_PASSWORD`,
  `/bitnami/postgresql` data dir, uid 1001); `pgvector/pgvector:pg17` is **official-postgres-based**
  (`POSTGRES_*`, `/var/lib/postgresql/data`, uid 999). Swapping it would require rewriting the
  secret/env/volume/securityContext of the foundational datastore — and a failure there breaks the
  whole `helm install`, blocking live-verification of every other change.

**Decision:** deferred as a separately-scoped item. Two viable real options for later: (a) publish/
build a bitnami-contract-compatible pgvector image and point the kind profile at it; or (b) stand up
an opt-in dedicated pgvector Postgres in the kind/eval profile and route a dedicated-DB tenant to it,
exercising the existing operator contract. Both are larger than the low-risk fix this issue assumed.

## Impact
A workspace creates the vector extension and runs a KNN similarity query.
