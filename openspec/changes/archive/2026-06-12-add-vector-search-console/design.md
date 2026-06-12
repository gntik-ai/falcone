## Context

The pgvector vector-search backend is fully implemented and tested. Three executor
route families are already live in
`apps/control-plane/src/runtime/server.mjs` (lines 237-261, 309-312):
- KNN search: `POST {data}/search` — `data = /v1/postgres/workspaces/{w}/data/{db}/schemas/{s}/tables/{t}`
- Vector index create: `POST {ddl}/{s}/tables/{t}/vector-indexes`
- Vector index delete: `DELETE {ddl}/{s}/tables/{t}/vector-indexes/{indexName}`
  where `ddl = /v1/postgres/databases/{db}/schemas`
- Embedding provider set: `PUT /v1/workspaces/{w}/embedding-provider`
- Embedding provider remove: `DELETE /v1/workspaces/{w}/embedding-provider`

The console already has two analogous data-editor surfaces that establish the pattern
to follow:
- `apps/web-console/src/services/postgresApi.ts` — service module over `requestConsoleSessionJson`
- `apps/web-console/src/services/mongoApi.ts` — same pattern
- `apps/web-console/src/components/console/PostgresDataEditor.tsx` / `MongoDataEditor.tsx`
- `apps/web-console/src/pages/ConsolePostgresDataPage.tsx` / `ConsoleMongoDataPage.tsx`
- Route + nav: `postgres/data` / `mongo/data` in `router.tsx` + `ConsoleShellLayout.tsx`

This change is purely additive frontend over existing tested endpoints; it does not
modify any backend code.

## Goals / Non-Goals

**Goals:**
- Add `apps/web-console/src/services/vectorSearchApi.ts` wrapping the five executor
  routes with typed interfaces.
- Add `apps/web-console/src/components/console/VectorSearchConsole.tsx` (+ co-located
  `.test.tsx`) with three panels: KNN Search, Vector Index, Embedding Provider.
- Add `apps/web-console/src/pages/ConsoleVectorSearchPage.tsx` composing
  `VectorSearchConsole` with active-workspace context.
- Wire route `postgres/vector-search` in `router.tsx` and nav entry "Data: Vector Search"
  in `ConsoleShellLayout.tsx`.
- Surface all backend errors (ApiError shape) as inline banners showing only the
  `message` field; never render stack traces or raw JSON.
- Surface `EMBEDDING_PROVIDER_MISSING` (422) with a link to the Embedding Provider panel.
- Accept only a `secretRef` name for provider credentials; never a raw API key value.

**Non-Goals:**
- Implementing or modifying any backend/executor code.
- Adding realtime/subscription wiring for search results.
- Adding a SQL query editor or schema browser (those are `ConsolePostgresPage`).
- A standalone index-browser that lists existing indexes (deferred; read path is not
  part of the vector-indexes route family).

## Decisions

**D1 — Single service module `vectorSearchApi.ts` for all five routes.**
Rationale: the five routes span two route families (workspace-scoped data + db-scoped
DDL + workspace-scoped embedding-provider), but from the console's perspective they are
all "vector-search operations". A single module keeps the import graph simple and
mirrors how `postgresApi.ts` centralises DDL + data + key operations.

**D2 — Three panels inside one `VectorSearchConsole` component.**
Rationale: the three features (KNN search, index management, provider config) are
logically distinct but always used together when working with vector data. A single
component with three collapsible or tab-separated panels mirrors
`PostgresDataEditor.tsx`'s combined data-grid + key-panel layout and avoids page
sprawl.

**D3 — Default metric = cosine, default top-K = 10.**
Rationale: cosine distance is the most common metric for text embedding use cases
(the primary driver for this feature); 10 is a small, safe default that does not
overwhelm the UI. Both values are overridable by the user.

**D4 — secretRef-only for embedding provider credentials.**
Rationale: the executor's `deployProvider` stores the config in Postgres
(`workspace_embedding_providers`); putting a raw API key in the console form would
require transmitting and briefly storing the key in session state and the DB. The
backend already accepts `secretRef` as the credential field; the console must only
accept that form to prevent key exposure. The form field is labelled "Secret Reference
(name only)" and there is no password-type input.

**D5 — Inline error banner via `getApiErrorMessage` / `normalizeApiError`.**
Rationale: `apps/web-console/src/lib/http.ts::normalizeApiError` (lines 77-94) and
`getApiErrorMessage` (already used in `ConsolePostgresPage`) extract only `message`.
All three panels follow this pattern — no `detail`, no stack trace, no raw body.

**D6 — EMBEDDING_PROVIDER_MISSING links to the provider panel.**
Rationale: this error is actionable (configure the provider) and occurs exactly when
the user first tries query-text search. An inline call-to-action avoids the user
having to scroll or know where the panel is.

**D7 — Test discipline: vitest component tests + tsc typecheck + vite build.**
Rationale: the backend routes are already covered by black-box tests and real-stack
tests (#346/#348); adding blackbox tests for the console UI would require a running
executor, which is outside the scope of this frontend change. The correct test gates
are:
1. `pnpm --filter @in-falcone/web-console test` — vitest co-located `.test.tsx` files
2. `pnpm --filter @in-falcone/web-console typecheck` — `tsc --noEmit`
3. `pnpm --filter @in-falcone/web-console build` — Vite production build

CI does NOT run the web-console vitest suite (the `quality` job runs `pnpm lint` +
node `test:*`); all three gates are run locally. Do NOT attempt to run
`bash tests/blackbox/run.sh` as the verification step for this change.

## Risks / Trade-offs

**Risk: The VectorSearchConsole component will be complex (three panels, five API calls).**
Mitigation: Extract each panel as a sub-component (`KnnSearchPanel`,
`VectorIndexPanel`, `EmbeddingProviderPanel`) within the same file (or co-located
files) so each can be unit-tested in isolation.

**Risk: The query-vector input accepts a JSON array that could be very large (1536+ floats).**
Mitigation: The input is a `<textarea>` not a line input; JSON parsing is done client-side
before the call; parse errors are surfaced as inline validation messages before the API
is called.

**Risk: Displaying KNN results that include vector column values would make the table
unreadable for high-dimension vectors.**
Mitigation: The `select` parameter defaults to excluding the raw vector column from
results; the user can override via an optional "select columns" input.

## Migration Plan

1. Add `apps/web-console/src/services/vectorSearchApi.ts` with typed interfaces.
2. Write co-located `vectorSearchApi.test.ts` to assert URL/method/payload for each function.
3. Add `VectorSearchConsole.tsx` with `KnnSearchPanel`, `VectorIndexPanel`,
   `EmbeddingProviderPanel` sub-components.
4. Write co-located `VectorSearchConsole.test.tsx` for each panel's happy path and
   the `EMBEDDING_PROVIDER_MISSING` error path.
5. Add `ConsoleVectorSearchPage.tsx` composing `VectorSearchConsole` with
   `useConsoleContext().activeWorkspaceId`.
6. Wire `postgres/vector-search` route in `router.tsx` (eager import, same pattern as
   `ConsolePostgresDataPage`).
7. Add "Data: Vector Search" nav entry in `ConsoleShellLayout.tsx`
   `consoleNavigationItems` array (after the "Data: Postgres" entry).
8. Verify: `pnpm --filter @in-falcone/web-console test` + `typecheck` + `build`.
