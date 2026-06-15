## ADDED Requirements

### Requirement: Data API capability has authoritative architecture documentation for the FerretDB+DocumentDB backend

The system SHALL maintain an authoritative architecture and operations runbook for its active document-store backend (FerretDB+DocumentDB) such that any operator can determine the two-layer component topology, the verified tenancy model (shared backing Postgres DB, app-layer `tenantId` scoping as the authoritative isolation boundary, RLS as hardening, hard isolation requiring a dedicated DocumentDB instance per tier), version-pinning constraints, upgrade order, and known compatibility differences without reading source code or Helm charts.

#### Scenario: Architecture documentation covers the active document-store backend

- **WHEN** an operator needs to understand the document-store backend topology
- **THEN** a documentation file exists in the repository that authoritatively describes the active backend's two-layer design, pinned image pair, upgrade order, the verified tenancy model (shared backing Postgres DB, app-layer `tenantId` scoping authoritative, RLS as hardening, hard isolation via dedicated DocumentDB instance per tier), and known compatibility differences with remediations

#### Scenario: No documentation file misidentifies the active document-store backend

- **WHEN** any repository documentation file references a document-store product by name
- **THEN** it names the currently active backend (FerretDB+DocumentDB) and does not present a superseded backend (MongoDB) as the active store
