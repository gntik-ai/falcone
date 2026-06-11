## ADDED Requirements

### Requirement: knn_search operation is added to the data API alongside existing CRUD

The system SHALL add `knn_search` to the set of recognised data API operations
(`services/adapters/src/postgresql-data-api.mjs::POSTGRES_DATA_API_OPERATIONS` and
`POSTGRES_DATA_API_CAPABILITIES`), exposed via `POST /v1/collections/{name}/search` with
`privilege_domain: "data_access"`, following the existing `/v1/collections/{name}/...`
route family convention in `services/gateway-config/public-route-catalog.json`. The KNN
plan builder SHALL reuse the existing `normalizeFilters` logic for the optional
hybrid-search filter (operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `like`,
`ilike`, `between`, `is`, `json_contains`, `json_path_eq` from
`POSTGRES_DATA_FILTER_OPERATORS`) and SHALL render a distance ordering clause `ORDER BY
<column> <operator> $queryVector LIMIT k` for the chosen distance metric. The existing
`normalizeOrder` function (column asc/desc only) is NOT modified; the KNN plan uses a
separate dedicated plan path (`buildPostgresKnnSearchPlan`, dispatched from
`buildPostgresDataApiPlan` for `operation: "knn_search"`).

#### Scenario: KNN search plan is built and executed for a valid request

- **WHEN** a data-access caller submits `POST /v1/collections/{name}/search` with
  `{ "queryVector": [...], "topK": 10, "metric": "cosine" }`
- **THEN** the plan builder emits SQL of the form
  `SELECT … FROM … WHERE <rls_clause> ORDER BY "embedding" <=> $1 LIMIT 10`,
  the executor runs it against the workspace database, and the response body contains
  up to 10 rows each with a `distance` field

#### Scenario: Hybrid KNN search combines distance ordering with a scalar filter

- **WHEN** a data-access caller submits a KNN search with both `queryVector` and
  `filter: [{ "columnName": "category", "operator": "eq", "value": "news" }]`
- **THEN** the SQL plan includes both the RLS clause, the scalar filter predicate, and
  the `ORDER BY distance LIMIT k` clause, returning only rows that pass both filters

#### Scenario: knn_search on a collection without a vector column is rejected

- **WHEN** a data-access caller submits a KNN search on a collection that has no
  column of type `vector`
- **THEN** the system rejects the request with HTTP 422 before executing any SQL,
  with an error identifying the absence of a vector column

#### Scenario: Missing queryVector and queryText is rejected

- **WHEN** a data-access caller submits a KNN search with neither `queryVector` nor
  `queryText`
- **THEN** the system rejects the request with HTTP 422 indicating that one of the
  two fields is required

### Requirement: Distance operator selection maps metric name to pgvector operator

The system SHALL map the `metric` field of a KNN search request to the corresponding
pgvector distance operator: `cosine` to `<=>`, `l2` to `<->`, and `inner_product`
to `<#>`. The default metric, when `metric` is omitted, SHALL be `cosine`.

#### Scenario: Cosine metric maps to <=> operator

- **WHEN** a KNN search request specifies `metric: "cosine"` (or omits `metric`)
- **THEN** the generated SQL ORDER BY clause uses the `<=>` operator

#### Scenario: L2 metric maps to <-> operator

- **WHEN** a KNN search request specifies `metric: "l2"`
- **THEN** the generated SQL ORDER BY clause uses the `<->` operator

#### Scenario: Inner-product metric maps to <#> operator

- **WHEN** a KNN search request specifies `metric: "inner_product"`
- **THEN** the generated SQL ORDER BY clause uses the `<#>` operator

#### Scenario: Unknown metric value is rejected

- **WHEN** a data-access caller submits a KNN search with an unrecognised `metric` value
- **THEN** the system rejects the request with HTTP 422 before issuing any SQL
