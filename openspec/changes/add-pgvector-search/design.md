# Design — add-pgvector-search

## Goals

1. A tenant runs `enableExtension('vector')` and 30 seconds later has working semantic
   search over an existing table.
2. A typical RAG query — embed a 100-token question + cosine-similarity over 100k
   vectors with `hnsw(m=16, ef=64)` — completes in ≤ 60 ms p99 at the adapter layer
   (excluding the embedding call itself).
3. Embedding-provider choice is per-workspace and pluggable; tenants who don't want
   any provider configured can still pass raw vectors.
4. Hybrid search is one canonical recipe (RRF) rather than open-ended composition.

## Non-goals

- **Hosting our own embedding model.** A `local` adapter that calls a sidecar
  (sentence-transformers or fastembed) is documented but not bundled by default; bundling
  is a [[deployment-and-operations]] decision.
- **Vector ANN index tuning UI.** We expose the knobs (`m`, `ef`, `lists`) but no
  auto-tune. Document the recipes; revisit when usage data justifies.
- **Cross-table vector joins.** Multi-table similarity is achievable via SQL functions
  ([[data-services]] D1 RPC); not a first-class search verb.

## Why a dedicated `/search` verb rather than extending `?filter=`

PostgREST's filter dialect doesn't have a similarity operator and shoehorning one in
muddies the operator set. A separate POST verb also (a) lets us carry the embedding
input in a structured body, (b) avoids cramming a 1536-element vector into a query
string, (c) opens space for the hybrid mode and `includeDistance` / `minScore` knobs.

## Embedding provider abstraction

```js
// services/adapters/src/embedding-providers/_interface.mjs
export class EmbeddingProvider {
  get model()       // "text-embedding-3-small", ...
  get dimensions()  // 1536, ...
  get batchSize()   // provider-specific max inputs per call
  async embed(inputs: string[] | { text: string }[]): Promise<Float32Array[]>
  async embedImage(inputs: { url: string }[]): Promise<Float32Array[]>  // optional
  estimateTokens(input: string): number
}
```

Adapters: `openai`, `voyage`, `cohere`, `jina`, `ollama`, `local`. Each adapter
declares whether it supports `embedImage`. The search endpoint refuses
`match.imageUrl` if the configured default provider doesn't.

Provider credentials and per-day token budgets are governed by the same plan-dimension
machinery as the rest of the platform.

## Hybrid search (RRF)

```python
# Pseudocode for the merger
def rrf(vectorHits, keywordHits, k=60, limit):
    scores = defaultdict(float)
    for rank, hit in enumerate(vectorHits):  scores[hit.id] += 1 / (k + rank)
    for rank, hit in enumerate(keywordHits): scores[hit.id] += 1 / (k + rank)
    return sorted(scores.items(), key=lambda x: -x[1])[:limit]
```

The vector and keyword sub-queries each request `limit * 3` rows; the merger trims
to `limit`. Default `k=60` matches the reference RRF paper; configurable per request
via `hybridK`.

## Query shape (cosine example)

```sql
WITH
  filtered AS (
    SELECT id, embedding
    FROM docs
    WHERE category = $1 AND active IS TRUE
  )
SELECT id, title, url, embedding <=> $2 AS distance,
       1 - (embedding <=> $2) AS score
FROM filtered
ORDER BY embedding <=> $2
LIMIT $3;
```

The `<=>` operator is cosine distance under pgvector. `l2` uses `<->`, `ip` (inner
product) uses `<#>`. The filter predicate is composed from the request's
`filter` field using the same parser as [[add-auto-rest-data-api]] (REQ-DAT-21).

Index pre-filtering: with HNSW we set `SET LOCAL hnsw.ef_search = $efSearch` (default
40, configurable per request) before the query.

## Index recipes (documented in console + docs)

| Use case | Index | Default params | Memory |
| --- | --- | --- | --- |
| ≤ 100k vectors, dev | none | — | 0 |
| 100k–1M vectors, latency-sensitive | `hnsw` | `m=16, ef_construction=64, ef_search=40` | ~1.5 GiB / 1M @ 1536-d |
| > 1M vectors, build-time matters | `ivfflat` | `lists = sqrt(N)` | ~600 MiB / 1M @ 1536-d |

## Quotas and safety

- Dimension cap defaults to 4096 (cover the long tail; modern models top out at 3072).
  Tenants on a plan with `data_api.vector.dimensions.max` lower than the request fail
  fast at column-creation time.
- `matches_per_query.max` (default 1000) prevents memory blow-up on `limit=1000000`
  pathological queries.
- Embedding-provider failures degrade the search: if the embed call fails and
  `match.vector` was not provided, return `502 embedding_provider_failed` rather than
  silently returning unranked results.
- The embedding call cost is reported as a usage event so [[quota-and-billing]] can
  bill or rate-limit it; per-day token budgets enforced at the adapter.

## Open questions

- **Q-VEC-01.** Should we expose **half-precision vectors** (`halfvec` in pgvector
  ≥ 0.7) as a separate column kind? Half memory, modest accuracy loss. Lean **yes** —
  it's a one-bit decision on column create.
- **Q-VEC-02.** Hybrid mode using BM25 (via `pg_search` / `paradedb`) instead of
  `to_tsquery`? Better quality, heavier dependency. Lean **defer** — keep `to_tsquery`
  baseline, document `paradedb` as an opt-in for power users.
- **Q-VEC-03.** Should embedding providers be at workspace scope (proposed) or tenant
  scope? Lean **workspace** — matches every other tenant-bound configuration in the
  platform and avoids credential bleed across workspaces.
