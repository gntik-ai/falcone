# Tasks — add-pgvector-image-for-vector-search

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: direct `CREATE EXTENSION IF NOT EXISTS vector` on `wsdb_acme_app_staging` -> ERROR extension not available; chart `values.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Use the `pgvector/pgvector` image for the shared (or dedicated) Postgres in profiles that must support vector search; verify `CREATE EXTENSION vector` + a KNN query through the data API.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A workspace creates the vector extension and runs a KNN similarity query.

## Archive
- [ ] `openspec validate add-pgvector-image-for-vector-search --strict`; `/opsx:archive add-pgvector-image-for-vector-search` after merge.
