## MODIFIED Requirements

### Requirement: Vector search is usable or reports itself unavailable

The executor SHALL check whether the resolved workspace Postgres instance advertises `vector` in `pg_available_extensions` before executing tenant vector operations. It SHALL reuse the provisioning extension-availability query, propagate probe errors through existing database error handling, and never proceed to vector SQL after a failed probe.

#### Scenario: Vector capability is absent

- **GIVEN** the resolved workspace instance has no vector extension control file
- **WHEN** the tenant requests KNN search, vector-index creation/deletion, vector column DDL, an embedding-mapping write, or an auto-embedding write targeting a vector column
- **THEN** the response is HTTP 501 with code `CAPABILITY_UNAVAILABLE`, capability `vector_search`, and a fixed safe message
- **AND** the operation executes no DDL/DML and performs no embedding-provider call
- **AND** the body contains no connection details, SQL, driver diagnostics, or stack trace

#### Scenario: Available instance

- **GIVEN** vector is available on the resolved instance
- **WHEN** a tenant performs vector operations
- **THEN** existing KNN, vector DDL, mapping, and auto-embedding behavior is preserved
- **AND** successful probes may be reused for at most sixty seconds, keyed only by resolved host:port

#### Scenario: Operator repairs the instance

- **WHEN** vector becomes available after an unavailable request
- **THEN** subsequent requests probe again without requiring an executor restart
- **AND** negative results are never cached

#### Scenario: Probe race or missing vector operator/type

- **WHEN** vector execution raises SQLSTATE 42704 or 42883 identifying a missing vector type, operator, operator class, function, or hnsw/ivfflat access method
- **THEN** the same capability-unavailable envelope is returned
- **AND** unrelated SQL errors, including missing tenant indexes named `vector` or `vector_idx`, retain their existing mapping

#### Scenario: DDL preview

- **WHEN** a tenant requests vector DDL with `mode=preview` or `dryRun`
- **THEN** the executor returns the in-memory plan with `executed: false` and `executionMode: preview`, including an empty plan
- **AND** no database connection is resolved or probed and no SQL executes

#### Scenario: Mapping writes and reads

- **WHEN** vector is unavailable or the workspace database cannot be resolved
- **THEN** mapping PUT and DELETE fail before changing metadata, preserving existing mappings
- **AND** mapping GET does not require a workspace database connection or vector probe

#### Scenario: Probe failure

- **WHEN** the catalog probe raises a connection, permission, or other database error
- **THEN** existing database error handling applies
- **AND** no vector operation runs

#### Scenario: Plain data operations

- **WHEN** a tenant uses non-vector CRUD or plain index/column DDL
- **THEN** no vector availability probe is issued
- **AND** existing responses and safety gates are preserved
