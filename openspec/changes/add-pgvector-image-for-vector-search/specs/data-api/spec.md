# data-api — spec delta for add-pgvector-image-for-vector-search

## ADDED Requirements

### Requirement: Vector search requires the pgvector image (kind profile uses a non-pgvector Postgres)

The system SHALL ensure that vector search requires the pgvector image (kind profile uses a non-pgvector Postgres): Use the `pgvector/pgvector` image for the shared (or dedicated) Postgres in profiles that must support vector search; verify `CREATE EXTENSION vector` + a KNN query through the data API.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A workspace creates the vector extension and runs a KNN similarity query
