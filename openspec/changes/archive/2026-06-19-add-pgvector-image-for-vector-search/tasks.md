# Tasks — add-pgvector-image-for-vector-search

## Reproduce (test-first)
- [x] Add a black-box helm-template test (`tests/blackbox/pgvector-dedicated-instance.test.mjs`)
  asserting an opt-in dedicated pgvector instance — fails before the chart component exists.
- [x] Confirm the KNN SQL/extension path is exercised real-stack
  (`tests/env/executor/vector-search-knn-rls.test.mjs` runs on `pgvector/pgvector`).

## Implement (kind runtime AND shippable product as applicable)
- [x] Add the `postgresqlVector` component-wrapper alias (`Chart.yaml`) + values stanza
  (`values.yaml`) on the `pgvector/pgvector:pg17` image, disabled by default, official-postgres
  contract (uid 999, PGDATA sub-dir, `in-falcone-postgresql-vector` Secret).
- [x] Add the kind opt-in overlay `deploy/kind/values-kind-vector.yaml`.
- [x] Confirm the shared bitnami `postgresql` instance and the provisioning pre-flight rejection are
  unchanged (vector stays a dedicated-DB capability by design).

## Verify
- [x] Black-box suite green (4 helm-template tests): default render has no pgvector workload; the
  overlay renders the pgvector StatefulSet (uid 999, contract image); the shared image is unchanged;
  the operator contract is preserved.
- [x] Acceptance proven real-stack: 7/7 vector tests pass on pgvector — `CREATE EXTENSION vector`,
  `vector(N)` column + HNSW cosine index, KNN `ORDER BY distance`, cross-tenant scan returns 0 rows.

## Archive
- [ ] `openspec validate add-pgvector-image-for-vector-search --strict`; `/opsx:archive add-pgvector-image-for-vector-search` after merge.
