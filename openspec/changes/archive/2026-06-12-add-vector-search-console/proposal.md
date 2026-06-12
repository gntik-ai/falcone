## Why

The pgvector vector-search capability is fully implemented and tested
(`add-vector-search` + `add-embedding-provider-persistence`): KNN search, hybrid
search, vector index creation/deletion, and embedding-provider set/remove all have
backend routes and black-box coverage (#346/#348). However, the console offers no UI
surface for any of these features. Developers must reach the executor directly via
`curl` or external tooling to run a similarity search, manage vector indexes, or
configure the workspace embedding provider. The missing UI blocks adoption of the
vector-search capability for the majority of workspace users who operate primarily
through the console. This change adds the console surface in the same pattern
established by `add-console-postgres-data-editor` and `add-mongo-data-execute`.

## What Changes

- **`services/vectorSearchApi.ts`** — new typed service module under
  `apps/web-console/src/services/` that wraps the five executor routes (KNN search,
  vector-index create, vector-index delete, embedding-provider set/remove) via
  `requestConsoleSessionJson` from `@/lib/console-session`.
- **`VectorSearchConsole.tsx`** — new component under
  `apps/web-console/src/components/console/` with three panels:
  - **KNN Search panel**: enter query vector (JSON array) or query text, choose
    metric (cosine default) and top-K (10 default), add optional scalar filters for
    hybrid search, and view ranked results with their `distance`.
  - **Vector Index panel**: create (HNSW default / IVFFlat, metric) and delete a
    vector index on a nominated column.
  - **Embedding Provider panel**: set provider (`providerType`, `model`, `endpoint?`,
    `dimension?`, `secretRef`) or remove it; the `secretRef` field accepts a
    Kubernetes/Vault secret reference NAME only — a raw key value is never accepted
    or displayed.
  Co-located `VectorSearchConsole.test.tsx` using `@testing-library/react` + vitest.
- **`ConsoleVectorSearchPage.tsx`** — new page under
  `apps/web-console/src/pages/` that reads `useConsoleContext().activeWorkspaceId`
  and renders `<VectorSearchConsole>` with db/schema/table state.
- **Router + nav** — new route `postgres/vector-search` in
  `apps/web-console/src/router.tsx` and a corresponding nav entry `"Data: Vector Search"`
  in `ConsoleShellLayout.tsx`, following the precedent of `"Data: Postgres"` at
  `/console/postgres/data`.

## Capabilities

### New Capabilities

_(none — this change adds a console surface to the existing vector-search capability)_

### Modified Capabilities

- `vector-search`: add console UI surface (page, component, service module, routing,
  and nav entry) so workspace users can run KNN searches, manage vector indexes, and
  configure the embedding provider from the web console without external tooling.

## Impact

- `apps/web-console/src/services/vectorSearchApi.ts` — new; typed wrapper for the
  five executor routes.
- `apps/web-console/src/components/console/VectorSearchConsole.tsx` — new; three-panel
  console component.
- `apps/web-console/src/components/console/VectorSearchConsole.test.tsx` — new;
  co-located vitest component tests.
- `apps/web-console/src/pages/ConsoleVectorSearchPage.tsx` — new page.
- `apps/web-console/src/router.tsx` — new route `postgres/vector-search`.
- `apps/web-console/src/layouts/ConsoleShellLayout.tsx` — new nav entry.
- No backend changes; all executor routes are already implemented and tested.
- Prerequisite changes (all archived): `add-vector-search`, `add-embedding-provider-persistence`,
  `add-console-postgres-data-editor` (establishes the service-layer and console-session
  patterns this change reuses).
