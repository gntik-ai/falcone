# add-pgvector-search

## Why

Every AI-adjacent application built in the last two years uses a vector store: RAG over
documents, semantic search, recommendation, deduplication, anomaly detection, clustering.
Supabase ships **pgvector** as a one-click extension and a documented `vecs` Python
client; Firebase has a Firestore vector index in preview; Appwrite has a `Databases.search`
that's quietly vector-backed; pgvector itself is the de facto standard with > 30 k
GitHub stars.

Falcone runs Postgres. The work to "support vectors" is mostly:
1. Enable the `vector` extension on tenant databases (governance change).
2. Expose vector column/index management through the structural-admin adapter
   ([[data-services]] D1).
3. Add a dedicated `/v1/data/.../search` shape that maps to a `<->` / `<=>` / `<#>`
   query because PostgREST-style filter dialects don't express vector ops cleanly.
4. Optionally bundle an **embedding provider abstraction** so the same API can take
   `query: "text to embed"` and return matches.

This is the smallest, highest-leverage AI-era proposal Falcone can ship — it parks the
platform squarely inside the "yes, you can build RAG on us" conversation that no buyer
will skip in 2026.

## What Changes

1. **Enable `pgvector` on tenant Postgres databases** as a first-class governance
   action:
   - `POST   /v1/postgres/workspaces/{workspaceId}/{dbName}/extensions/vector` —
     enable the extension; idempotent.
   - `DELETE` of same — disable (only when no vector columns exist).
   - The platform ships `pgvector` ≥ 0.7 in the base Postgres image
     ([[deployment-and-operations]] dependency).
2. **Vector column and index DDL helpers** in
   [[data-services]] structural admin:
   - `POST   /v1/postgres/workspaces/{workspaceId}/{dbName}/tables/{schema}.{table}/vector-columns` —
     `{ name, dimensions, distanceMetric: "l2"|"cosine"|"ip" }`.
   - `POST   .../tables/{schema}.{table}/vector-indexes` —
     `{ column, indexKind: "ivfflat"|"hnsw", params: { lists?, m?, efConstruction? } }`.
   - `DELETE` analogues for both.
3. **Search endpoint** (extends [[add-auto-rest-data-api]] surface) — a dedicated
   verb because PostgREST filter syntax doesn't express vector similarity:
   - `POST /v1/data/{workspaceId}/{schema}.{table}/search`
     ```jsonc
     {
       "vectorColumn": "embedding",
       "match": { "vector": [0.12, ...] }            // raw vector, OR
                 // { "text": "what is your refund policy" }  with embeddingProvider configured
                 // { "imageUrl": "https://..." }             with multi-modal provider
       "limit": 10,
       "metric": "cosine",                           // overrides column default
       "filter": "category=eq.docs,active=is.true",  // standard PostgREST filter
       "select": "id,title,url",
       "includeDistance": true,
       "minScore": 0.78                              // post-filter on distance
     }
     ```
   - Response: `{ matches: [ { row, distance, score } ], embedding?, embeddingTimingMs? }`.
4. **Embedding provider abstraction** (optional per workspace):
   - `GET|PUT /v1/data/workspaces/{workspaceId}/embedding-providers/{slug}` —
     `{ enabled, kind: "openai"|"voyage"|"cohere"|"local"|"jina"|"ollama",
        credentials, model, dimensions, batchSize, isDefault, costPerKTokens? }`.
   - When `match.text` or `match.imageUrl` is used, the search endpoint embeds via the
     workspace's default provider before the SQL query.
5. **Hybrid search helper** (one canonical recipe rather than open-ended):
   - `POST .../search` accepts `mode: "vector"|"keyword"|"hybrid"`. In `hybrid` mode
     the engine runs a vector search and a `to_tsquery` keyword search, then merges
     with **Reciprocal Rank Fusion** (RRF) with configurable `k` (default 60).
6. **Quotas:**
   - `data_api.vector.searches.per_minute`, `data_api.vector.dimensions.max` (default 4096),
     `data_api.vector.matches_per_query.max` (default 1000),
     `data_api.embeddings.tokens.per_day`, `data_api.embeddings.providers.max`.
7. **Console:** the `ConsoleDataApiPage` (planned in [[add-auto-rest-data-api]]) gains a
   per-table "Vector" tab — columns, indexes, distance metric, a search playground.

## Impact

- **Affected specs**:
  - `openspec/specs/data-services/spec.md` — adds REQs for extension management, vector
    column/index DDL helpers, the `/search` verb, embedding providers, and hybrid search.
- **Affected code**:
  - `services/adapters/src/postgresql-structural-admin.mjs` — vector column + index DDL.
  - `services/adapters/src/postgresql-governance-admin.mjs` — extension enable/disable.
  - `services/adapters/src/postgresql-data-api.mjs` — `/search` route, embedding
    provider call, hybrid-RRF merger.
  - `services/adapters/src/embedding-providers/` (new) — OpenAI, Voyage, Cohere, Jina,
    Ollama, local (sentence-transformers via sidecar) adapters.
  - `apps/control-plane/openapi/families/data.openapi.json` (extended) and
    `postgres.openapi.json` (extension/column/index).
  - `services/provisioning-orchestrator/src/migrations/NNN-embedding-providers.sql` —
    per-workspace provider config.
  - `services/internal-contracts/src/vector-search-{request,result,provider}-v1.json`.
- **Dependencies (hard)**:
  - [[add-auto-rest-data-api]] — the `/search` verb sits alongside `/v1/data/...`.
  - [[deployment-and-operations]] — pgvector must ship in the base Postgres image.
- **No breaking changes** — additive; vector columns are not exposed via standard
  PostgREST filters (no operator dialect exists for them) so the existing data API is
  unchanged.
