# Tasks — add-pgvector-search

- [ ] **T01** Confirm baseline green; confirm pgvector ≥ 0.7 is in the deployed
      Postgres image (otherwise add it via [[deployment-and-operations]] change).
- [ ] **T02** Extend `apps/control-plane/openapi/families/postgres.openapi.json` with
      extension management (`/extensions/vector`), vector-column DDL, vector-index DDL.
- [ ] **T03** Extend `apps/control-plane/openapi/families/data.openapi.json` with
      `POST /v1/data/{workspaceId}/{schema}.{table}/search`.
- [ ] **T04** Implement extension enable/disable in
      `services/adapters/src/postgresql-governance-admin.mjs` (idempotent;
      `DROP EXTENSION` only when no vector columns remain).
- [ ] **T05** Implement vector column + HNSW + IVFFlat helpers in
      `services/adapters/src/postgresql-structural-admin.mjs`.
- [ ] **T06** Implement embedding-provider interface and adapters (`openai`, `voyage`,
      `cohere`, `jina`, `ollama`, `local`) under
      `services/adapters/src/embedding-providers/`.
- [ ] **T07** Implement `/search` handler in
      `services/adapters/src/postgresql-data-api.mjs`: filter composition (reuse parser
      from [[add-auto-rest-data-api]]), distance op selection, hybrid RRF merger,
      `ef_search` GUC, embedding call.
- [ ] **T08** Migration `NNN-embedding-providers.sql` for per-workspace provider
      config; provider credentials stored in Vault.
- [ ] **T09** Add plan dimensions and wire enforcement.
- [ ] **T10** Console: extend `ConsoleDataApiPage` per-table view with a Vector tab
      (columns, indexes, distance metric, search playground).
- [ ] **T11** Contract tests: cosine vs. l2 vs. inner-product equivalence; HNSW vs.
      IVFFlat tuning; filter composition; hybrid RRF with k=60 reproduces published
      reference outputs; embed failure surfaces correctly.
- [ ] **T12** Run `openspec validate --strict` and re-run baseline validators.
