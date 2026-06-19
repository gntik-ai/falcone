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

## Decision (2026-06-19, confirmed with the operator)
Vector is a **dedicated-DB capability by design** — the shared bitnami instance correctly lacks
pgvector (`postgres-applier.mjs::_unavailableExtensionMessage` rejects `CREATE EXTENSION vector` with
an actionable message; `postgresql-structural-admin.mjs` only surfaces the `vector` type when the
extension is enabled). Force-swapping the shared image is high-risk (bitnami vs official-postgres
env/uid/volume contract — a failure breaks the whole install). So we take **option (b): an opt-in
dedicated pgvector Postgres**, realising the existing `postgresql.dedicatedTenantImage` operator
contract as an actually-deployable instance. The shared instance is untouched (zero install risk).

## What Changes
- Add an opt-in dedicated Postgres component on the `pgvector/pgvector:pg17` image
  (`postgresqlVector` component-wrapper alias + values stanza, **disabled by default**), using the
  official-postgres image contract (uid 999, `/var/lib/postgresql`, `POSTGRES_*`) like the documentdb
  engine. Admin creds from the operator-supplied `in-falcone-postgresql-vector` Secret.
- A kind overlay (`deploy/kind/values-kind-vector.yaml`) enables it; the default kind render contains
  no pgvector workload and the shared `postgresql` image is unchanged.
- A dedicated-DB workspace whose connection DSN resolves to this instance gets working
  `CREATE EXTENSION vector` + KNN. The per-workspace DSN routing primitive already exists
  (`connection-registry.mjs` `resolveConnection`). The KNN SQL/extension/index path is **proven
  real-stack** against `pgvector/pgvector` in `tests/env/executor/vector-search-knn-rls.test.mjs`
  (7/7: `vector(N)` column + HNSW cosine index, KNN `ORDER BY distance`, cross-tenant scan = 0 rows).

## Impact
A workspace creates the vector extension and runs a KNN similarity query.

- `charts/in-falcone/Chart.yaml` (+`postgresqlVector` alias), `charts/in-falcone/values.yaml` (stanza).
- `deploy/kind/values-kind-vector.yaml` (new opt-in overlay).
- Tests: `tests/blackbox/pgvector-dedicated-instance.test.mjs` (helm-template) + the existing
  real-stack `tests/env/executor/vector-search-knn-rls.test.mjs`.
