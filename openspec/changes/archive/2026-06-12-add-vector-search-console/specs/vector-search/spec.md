## ADDED Requirements

### Requirement: The console provides a vector-search view scoped to the active workspace

The system SHALL provide a dedicated vector-search page (`ConsoleVectorSearchPage`,
route `postgres/vector-search`) within the web console, reachable from a nav entry
"Data: Vector Search" in `ConsoleShellLayout.tsx`, that is scoped to the active
workspace resolved from `useConsoleContext().activeWorkspaceId`, so that workspace users
can access all vector-search operations without leaving the console. The page SHALL
follow the layout and session patterns established by
`apps/web-console/src/pages/ConsolePostgresDataPage.tsx` and its nav entry.

#### Scenario: Vector-search page is accessible from the console navigation

- **WHEN** a console user is authenticated and selects a workspace in the header
  context picker, then clicks the "Data: Vector Search" nav link
- **THEN** the browser navigates to `/console/postgres/vector-search` and the
  `ConsoleVectorSearchPage` renders with the active `workspaceId` in scope,
  displaying the three panels: KNN Search, Vector Index, and Embedding Provider

#### Scenario: Page shows a prompt when no workspace is selected

- **WHEN** a console user navigates to `/console/postgres/vector-search` without a
  workspace selected in the context picker
- **THEN** the page renders an empty-state prompt instructing the user to select a
  workspace before performing vector-search operations

### Requirement: A typed service module wraps the five executor vector-search routes

The system SHALL provide a typed TypeScript service module
(`apps/web-console/src/services/vectorSearchApi.ts`) that delegates all HTTP calls to
`requestConsoleSessionJson` from `@/lib/console-session`, covering the five executor
routes so that `VectorSearchConsole` components have a stable, testable interface
independent of URL construction details:
- KNN search: `POST /v1/postgres/workspaces/{w}/data/{db}/schemas/{s}/tables/{t}/search`
- Vector index create: `POST /v1/postgres/databases/{db}/schemas/{s}/tables/{t}/vector-indexes`
- Vector index delete: `DELETE /v1/postgres/databases/{db}/schemas/{s}/tables/{t}/vector-indexes/{indexName}`
- Embedding provider set: `PUT /v1/workspaces/{w}/embedding-provider`
- Embedding provider remove: `DELETE /v1/workspaces/{w}/embedding-provider`

#### Scenario: Service module is the sole HTTP caller for vector-search operations

- **WHEN** `VectorSearchConsole` or a sub-component needs to call any vector-search
  executor route
- **THEN** all HTTP calls go through `vectorSearchApi.ts` rather than calling
  `requestConsoleSessionJson` inline, so that URL construction and response-type
  assertions are centralised and independently testable

### Requirement: The user can run a KNN similarity search from the console

The system SHALL allow a console user to execute a KNN similarity search from the
KNN Search panel by entering either a query vector (JSON array of numbers) or query
text (in-platform embedding via the configured provider), selecting a distance metric
(`cosine` default, `l2`, `inner_product`) and a top-K value (default 10), and
optionally adding scalar column filters for hybrid search. Results SHALL be displayed
as a ranked table of rows ordered nearest-first, each row including its `distance`
value, so that developers can interactively explore their vector data from the console.

#### Scenario: KNN search with a query vector returns ranked results

- **WHEN** a console user enters a valid JSON array as the query vector, sets top-K
  to 5, selects metric "cosine", and submits the KNN search form
- **THEN** `vectorSearchApi.knnSearch` is called with the correct `queryVector`,
  `metric`, and `topK` parameters, the response rows are rendered in a table ordered
  by ascending `distance`, and at most 5 rows are displayed

#### Scenario: KNN search with query text triggers in-platform embedding

- **WHEN** a console user enters a text string in the query-text input, leaves the
  query-vector input empty, and submits the KNN search form
- **THEN** `vectorSearchApi.knnSearch` is called with `queryText` (not `queryVector`),
  and results are displayed if the workspace has a configured embedding provider

#### Scenario: Hybrid search applies scalar filters alongside the vector query

- **WHEN** a console user adds one or more scalar column filters in addition to the
  query vector and submits the KNN search form
- **THEN** `vectorSearchApi.knnSearch` is called with both `queryVector`/`queryText`
  and the `filter` object, and only rows matching the scalar filter appear in the
  result table

### Requirement: The EMBEDDING_PROVIDER_MISSING error is surfaced clearly with a link to provider config

The system SHALL detect the HTTP 422 response with `code: "EMBEDDING_PROVIDER_MISSING"`
returned by the executor when a `queryText` KNN request targets a workspace with no
configured provider, and SHALL display a clear inline error message naming the error
code together with a link to the Embedding Provider panel, so that the user knows how
to resolve the missing-provider state without inspecting raw HTTP responses.

#### Scenario: EMBEDDING_PROVIDER_MISSING error links to provider config

- **WHEN** a console user submits a KNN search using query text and the executor
  returns HTTP 422 with `code: "EMBEDDING_PROVIDER_MISSING"`
- **THEN** the KNN Search panel renders an inline error banner containing the text
  "EMBEDDING_PROVIDER_MISSING" and a link or button that navigates the user to the
  Embedding Provider panel (or scrolls it into view) so they can configure a provider

#### Scenario: Dimension-mismatch error (400/422) is surfaced as an inline banner

- **WHEN** the executor returns HTTP 400 or 422 for a KNN search (e.g. wrong vector
  dimension or missing `vectorColumn`)
- **THEN** the panel displays the `message` field from the error response as an inline
  banner without a stack trace or raw JSON body

### Requirement: The user can create and delete vector indexes from the console

The system SHALL provide a Vector Index panel within `VectorSearchConsole` that allows
a console user to create a vector index on a nominated column by selecting index type
(HNSW default, IVFFlat) and metric (cosine default), or to delete an existing vector
index by name, via calls to `vectorSearchApi.createVectorIndex` and
`vectorSearchApi.deleteVectorIndex` respectively.

#### Scenario: Create an HNSW cosine index via the console

- **WHEN** a console user fills in the db, schema, table, column, leaves index type as
  HNSW and metric as cosine, and confirms the create-index action
- **THEN** `vectorSearchApi.createVectorIndex` is called with `indexType: "hnsw"` and
  `metric: "cosine"`, a success confirmation is shown, and the index name is reflected
  in the UI

#### Scenario: Delete a vector index via the console

- **WHEN** a console user enters an index name and confirms the delete-index action
- **THEN** `vectorSearchApi.deleteVectorIndex` is called with the correct `indexName`,
  and a success confirmation is shown; on failure the `message` field is displayed as
  an inline error banner

#### Scenario: Index management error is surfaced clearly

- **WHEN** a create or delete call returns a 4xx or 5xx response
- **THEN** the Vector Index panel displays the `message` field from the error response
  as an inline error banner without a stack trace or raw JSON body

### Requirement: The user can set and remove the workspace embedding provider from the console

The system SHALL provide an Embedding Provider panel within `VectorSearchConsole` that
allows a console user to configure the workspace embedding provider by entering
`providerType`, `model`, `endpoint` (optional), `dimension` (optional), and `secretRef`
(a secret reference NAME, never a raw API key), or to remove the provider configuration,
via calls to `vectorSearchApi.setEmbeddingProvider` and
`vectorSearchApi.removeEmbeddingProvider`. The UI SHALL only accept a `secretRef` name
for the provider credential, and SHALL never display or accept a raw API key value.

#### Scenario: Set the embedding provider with a secretRef

- **WHEN** a console user enters a `providerType`, `model`, and `secretRef` name in the
  Embedding Provider panel and submits the form
- **THEN** `vectorSearchApi.setEmbeddingProvider` is called with a body containing
  `providerType`, `model`, and `secretRef` but no raw credential value, and a success
  confirmation is displayed

#### Scenario: Remove the embedding provider

- **WHEN** a console user clicks the remove-provider action in the Embedding Provider
  panel and confirms the destructive action
- **THEN** `vectorSearchApi.removeEmbeddingProvider` is called and a success
  confirmation is shown; the panel reverts to the not-configured state

#### Scenario: Raw API key is never accepted or displayed in the provider form

- **WHEN** the Embedding Provider panel renders the provider configuration form
- **THEN** the form contains only a `secretRef` field for credentials (no "API key"
  or "password" free-text input), and the rendered HTML contains no input of type
  `password` or field labelled with "key" or "secret value" that would accept a raw key

#### Scenario: Provider configuration error is surfaced clearly

- **WHEN** the set- or remove-provider call returns a 4xx or 5xx response
- **THEN** the Embedding Provider panel displays the `message` field from the error
  response as an inline error banner without a stack trace or raw body
