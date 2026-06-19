# data-api — spec delta for add-pgvector-image-for-vector-search

## ADDED Requirements

### Requirement: Vector search is available via a dedicated pgvector instance

Vector/KNN search SHALL be a dedicated-DB capability. The shared bitnami `postgresql` instance does
not bundle pgvector, and the provisioning pre-flight SHALL reject `CREATE EXTENSION vector` on it with
an actionable message naming a pgvector-capable image (this behaviour is preserved, not changed).

The chart SHALL provide an OPT-IN dedicated Postgres instance on the `pgvector/pgvector` image
(`postgresqlVector`, disabled by default) so an operator/eval profile can stand up a vector-capable
database without altering the foundational shared instance. The kind profile SHALL enable it via a
dedicated overlay (`deploy/kind/values-kind-vector.yaml`); the default render SHALL contain no
pgvector workload, and enabling the dedicated instance SHALL NOT change the shared `postgresql` image.

A dedicated-DB workspace whose database connection resolves to the pgvector instance SHALL be able to
enable the `vector` extension and run a KNN similarity query through the data API, with tenant
isolation enforced (a KNN scan under one tenant's context returns none of another tenant's rows).

#### Scenario: A workspace creates the vector extension and runs a KNN similarity query

- **WHEN** a dedicated-DB workspace backed by the pgvector instance issues `CREATE EXTENSION vector`
- **THEN** the extension is created (it is available on the pgvector image)
- **AND WHEN** the workspace creates a `vector(N)` column with an HNSW index and runs a KNN
  `ORDER BY distance` query under its tenant context
- **THEN** the query returns nearest rows scoped to that tenant only (no cross-tenant rows)

#### Scenario: The shared instance correctly refuses vector and the dedicated instance is opt-in

- **WHEN** `CREATE EXTENSION vector` is attempted on the shared bitnami `postgresql` instance
- **THEN** the provisioning pre-flight rejects it with an actionable message naming the
  pgvector-capable image (working-as-designed)
- **AND WHEN** the chart is rendered without the vector overlay
- **THEN** no dedicated pgvector workload renders and the shared `postgresql` image is unchanged
