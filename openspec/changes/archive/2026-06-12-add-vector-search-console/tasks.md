## T01: Confirm baseline green

> Reality note: the workspace `typecheck` and `build` scripts already fail on a clean
> tree due to pre-existing errors in unrelated files (e.g. `src/main.tsx` react-router
> version skew, `ConsoleDocsPage.tsx`, `ConsoleMembersPage.tsx`, `ConsoleSecretsPage.tsx`,
> Plan* components/tests). CI runs `npm run lint` + node `test:*`, not the web-console
> `tsc -b`/`vite build`, so these do not break CI. The gate applied for this change is:
> the new files (`vectorSearchApi.ts`, `VectorSearchConsole.tsx`, `ConsoleVectorSearchPage.tsx`
> + tests) introduce ZERO new typecheck/build errors, and the failing-file set is identical
> before and after the change.

- [x] T01.1 Run `pnpm --filter @in-falcone/web-console typecheck` — no NEW TS errors from this change
- [x] T01.2 Run `pnpm --filter @in-falcone/web-console build` — no NEW errors from this change (pre-existing failures unchanged)
- [x] T01.3 Run `openspec validate add-vector-search-console --strict` — valid

## T02: Add `vectorSearchApi.ts` service module (test-first)

- [x] T02.1 Write `apps/web-console/src/services/vectorSearchApi.test.ts` asserting URL,
  method, and request body for all five functions — RED before implementation
- [x] T02.2 Create `apps/web-console/src/services/vectorSearchApi.ts`
- [x] T02.3 Implement `knnSearch(workspaceId, db, schema, table, params): Promise<KnnSearchResult>` —
  `POST /v1/postgres/workspaces/{w}/data/{db}/schemas/{s}/tables/{t}/search`;
  body `{ queryVector?, queryText?, vectorColumn, metric?, topK?, filter?, select? }`
- [x] T02.4 Implement `createVectorIndex(db, schema, table, params): Promise<DdlResult>` —
  `POST /v1/postgres/databases/{db}/schemas/{s}/tables/{t}/vector-indexes`;
  body `{ indexType, column, metric?, indexName? }`; default `indexType: "hnsw"`
- [x] T02.5 Implement `deleteVectorIndex(db, schema, table, indexName): Promise<void>` —
  `DELETE /v1/postgres/databases/{db}/schemas/{s}/tables/{t}/vector-indexes/{indexName}`
- [x] T02.6 Implement `setEmbeddingProvider(workspaceId, config): Promise<EmbeddingProviderResult>` —
  `PUT /v1/workspaces/{w}/embedding-provider`;
  body `{ providerType, model, endpoint?, dimension?, secretRef }` — no raw key
- [x] T02.7 Implement `removeEmbeddingProvider(workspaceId): Promise<void>` —
  `DELETE /v1/workspaces/{w}/embedding-provider`
- [x] T02.8 Export types: `KnnSearchResult`, `KnnRow`, `VectorMetric`, `VectorIndexType`,
  `EmbeddingProviderConfig`, `EmbeddingProviderResult`
- [x] T02.9 Run `pnpm --filter @in-falcone/web-console test` — T02.1 tests GREEN

## T03: Add `VectorSearchConsole.tsx` component (test-first)

- [x] T03.1 Write `apps/web-console/src/components/console/VectorSearchConsole.test.tsx`
  covering the scenarios below — RED before implementation:
  - KNN search happy path: submit query vector, results table renders with `distance` column
  - KNN search with `EMBEDDING_PROVIDER_MISSING` 422: error banner + provider-panel link renders
  - KNN dimension-mismatch error (400): error banner renders with `message` field
  - Create vector index happy path: success confirmation renders
  - Index management error (4xx): error banner renders with `message` field
  - Set embedding provider happy path: success confirmation renders
  - Remove embedding provider (destructive confirm): success confirmation renders
  - Provider form has no raw-key input (no `type="password"` or unlabelled key field)
- [x] T03.2 Create `apps/web-console/src/components/console/VectorSearchConsole.tsx`
- [x] T03.3 Implement `KnnSearchPanel` sub-component:
  - Textarea for query vector (JSON array) and text input for query text (mutually exclusive)
  - Select for metric (`cosine` default, `l2`, `inner_product`) and number input for top-K (default 10)
  - Dynamic filter builder: add/remove column=value rows for hybrid search
  - "Search" submit button; loading state while in-flight
  - Results table: rows ordered nearest-first, columns including `distance`; vector columns
    excluded from display by default (pass `select` to omit raw vector column)
  - Inline error banner from `message` field on any API error
  - Special handling for `EMBEDDING_PROVIDER_MISSING`: banner includes a link/button that
    scrolls to or expands the Embedding Provider panel
- [x] T03.4 Implement `VectorIndexPanel` sub-component:
  - Inputs: db, schema, table, column name, index type (HNSW default / IVFFlat), metric (cosine default),
    optional index name
  - "Create Index" button; success confirmation on 200/201
  - "Delete Index" section: index name input + confirmation dialog; success confirmation on 200/204
  - Inline error banner from `message` field on any API error
- [x] T03.5 Implement `EmbeddingProviderPanel` sub-component:
  - Inputs: `providerType` (select or text), `model`, optional `endpoint`, optional `dimension`,
    `secretRef` (plain text input labelled "Secret Reference Name — not a raw API key")
  - No `type="password"` input; no field labelled "API key value" or "secret value"
  - "Save Provider" button; success confirmation on 200
  - "Remove Provider" button with `DestructiveConfirmationDialog`; success confirmation on 200/204
  - Inline error banner from `message` field on any API error
- [x] T03.6 Run `pnpm --filter @in-falcone/web-console test` — T03.1 tests GREEN

## T04: Add `ConsoleVectorSearchPage.tsx` page

- [x] T04.1 Create `apps/web-console/src/pages/ConsoleVectorSearchPage.tsx`
- [x] T04.2 Read `activeWorkspaceId` from `useConsoleContext()`; show empty-state prompt
  if no workspace is selected (consistent with `ConsolePostgresDataPage` behaviour)
- [x] T04.3 Manage local state: `databaseName`, `schemaName`, `tableName` (text inputs or
  selectors matching the pattern in `ConsolePostgresDataPage`)
- [x] T04.4 Render `<VectorSearchConsole workspaceId={activeWorkspaceId} ... />` when
  workspace + table coordinates are present

## T05: Router and nav wiring

- [x] T05.1 Add eager import `import { ConsoleVectorSearchPage } from '@/pages/ConsoleVectorSearchPage'`
  to `apps/web-console/src/router.tsx` (same pattern as `ConsolePostgresDataPage`)
- [x] T05.2 Add route `{ path: 'postgres/vector-search', element: <ConsoleVectorSearchPage /> }`
  inside the `console` children array in `router.tsx`, after the `postgres/data` route
- [x] T05.3 Add nav entry to `consoleNavigationItems` in
  `apps/web-console/src/layouts/ConsoleShellLayout.tsx`:
  ```
  {
    label: 'Data: Vector Search',
    to: '/console/postgres/vector-search',
    icon: Database,
    description: 'KNN similarity search, vector index management, and embedding provider config.'
  }
  ```
  Position: immediately after the "Data: Postgres" entry

## T06: Integration verification

- [x] T06.1 Run `pnpm --filter @in-falcone/web-console test` — new tests (28) pass; pre-existing
  failures (66 in 8 unrelated files) unchanged, no regressions (437→465 passing)
- [x] T06.2 Run `pnpm --filter @in-falcone/web-console typecheck` — no NEW errors in the change's files
- [x] T06.3 Run `pnpm --filter @in-falcone/web-console build` — no NEW errors from this change
  (the `tsc -b` step fails only on pre-existing unrelated files; see the T01 reality note)
- [x] T06.4 Run `openspec validate add-vector-search-console --strict` — valid
- [x] T06.5 Run `npm run lint` (repo root) — green (unaffected by this frontend change)

Note: `bash tests/blackbox/run.sh` is NOT the verification gate for this change. The
backend contract is already covered by black-box + real-stack tests from `add-vector-search`
and `add-embedding-provider-persistence` (#346/#348). The correct gates for this
purely-frontend change are the three pnpm steps in T06.1–T06.3.
