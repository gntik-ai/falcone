## ADDED Requirements

### Requirement: Vector field type with mandatory dimension is accepted by the DDL surface

The system SHALL accept `dataType: "vector"` (rendered as `vector(N)` in SQL) as a
valid column type in structural DDL requests, require a positive integer `dimension`
attribute in range 1-16000, and reject the column definition with HTTP 422 if
`dimension` is absent or out of range. This builds on the existing column type pipeline
in `apps/control-plane/src/runtime/postgres-ddl-executor.mjs::buildDdlPlan` and the
structural admin plan builder.

#### Scenario: Vector column DDL with valid dimension is accepted

- **WHEN** a structural admin submits a column creation request with
  `dataType: "vector"` and `dimension: 768`
- **THEN** the DDL plan contains `ALTER TABLE … ADD COLUMN … vector(768)`, the executor
  runs it, and the column is present in `information_schema.columns` for that table

#### Scenario: Vector column DDL without dimension is rejected before SQL

- **WHEN** a structural admin submits a column creation request with
  `dataType: "vector"` and no `dimension` field
- **THEN** the system returns HTTP 422 with an error identifying `dimension` as
  required, and no SQL statement is executed against the database

#### Scenario: Vector column DDL with dimension out of range is rejected

- **WHEN** a structural admin submits a column creation request with
  `dataType: "vector"` and `dimension: 0` (or greater than 16000)
- **THEN** the system returns HTTP 422 before issuing any DDL

### Requirement: Vector index declaration (HNSW/IVFFlat) is accepted by the DDL surface

The system SHALL accept a vector index declaration on a column of type `vector(N)`,
with `indexType` of `hnsw` (default) or `ivfflat`, and a `metric` of `cosine`
(default, opclass `vector_cosine_ops`), `l2` (`vector_l2_ops`), or `inner_product`
(`vector_ip_ops`). The DDL executor SHALL render and execute the corresponding
`CREATE INDEX … USING hnsw/ivfflat` statement, following the existing index-creation
path in `apps/control-plane/src/runtime/postgres-ddl-executor.mjs`.

#### Scenario: HNSW cosine index DDL is rendered correctly

- **WHEN** a structural admin submits a vector index request with defaults (no
  `indexType`, no `metric`)
- **THEN** the DDL plan contains
  `CREATE INDEX … ON … USING hnsw ("<column>" vector_cosine_ops)` and the index
  appears in `pg_indexes` after execution

#### Scenario: IVFFlat inner-product index DDL is rendered correctly

- **WHEN** a structural admin submits a vector index request with
  `indexType: "ivfflat"` and `metric: "inner_product"`
- **THEN** the DDL plan contains
  `CREATE INDEX … ON … USING ivfflat ("<column>" vector_ip_ops)`

#### Scenario: Index on non-vector column is rejected

- **WHEN** a structural admin requests a vector index on a column whose declared
  `dataType` is not `vector`
- **THEN** the system rejects the request with HTTP 422 before issuing any SQL
