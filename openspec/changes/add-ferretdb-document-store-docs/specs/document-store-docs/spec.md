## ADDED Requirements

### Requirement: FerretDB+DocumentDB architecture and operations runbook exists

The system SHALL maintain an authoritative FerretDB+DocumentDB architecture and operations runbook document in the repository documentation (under `docs-site/architecture/`) that describes: the two-layer design (FerretDB gateway fronting the DocumentDB engine); the deployment topology (dedicated Postgres instance, colocated topology rejected, engine-first startup); the bundled extensions (pgvector 0.8.1, PostGIS 3.6.0, rum 1.3, pg_cron 1.6); the pinned image pair and upgrade order (DocumentDB engine MUST be upgraded before the FerretDB gateway; the gateway MUST NEVER be advanced ahead of a matching engine release); the PostgreSQL extension prerequisites (`shared_preload_libraries`, DocumentDB GUCs); the verified tenancy model (shared backing Postgres DB, app-layer tenantId scoping authoritative, RLS as hardening, hard isolation via dedicated DocumentDB instance per tier); the known compatibility differences and their remediations; and a cross-reference to the change-stream remediation change.

#### Scenario: Runbook document is present and covers required sections

- **WHEN** a reviewer examines the repository documentation tree
- **THEN** a FerretDB+DocumentDB runbook document exists at a canonical path under `docs-site/architecture/` and contains sections covering the two-layer design, the deployment topology and bundled extensions, the pinned image pair, the upgrade order rule, PostgreSQL extension prerequisites, the verified tenancy model, and a compatibility-differences table

#### Scenario: Runbook states the upgrade order rule explicitly

- **WHEN** the FerretDB+DocumentDB runbook document is read
- **THEN** it contains an explicit statement that the DocumentDB engine image MUST be upgraded before the FerretDB gateway image, and that the gateway MUST NEVER be advanced ahead of a matching engine release

#### Scenario: Runbook cross-references ADR-14

- **WHEN** the FerretDB+DocumentDB runbook document is read
- **THEN** it contains a reference to ADR-14 (the FerretDB+DocumentDB adoption decision record) by name or link

#### Scenario: Runbook cross-references the change-stream remediation change

- **WHEN** the FerretDB+DocumentDB runbook document is read
- **THEN** it contains a cross-reference to the change-stream remediation change (`add-ferretdb-realtime-cdc-remediation`) by name or link, noting that FerretDB v2 does not support change streams

### Requirement: Pinned image pair is documented with version-compatibility rationale

The system SHALL document the pinned FerretDB gateway image tag (`ghcr.io/ferretdb/ferretdb:2.7.0`) and DocumentDB engine image tag (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) together in the runbook, with an explanation of how to verify version compatibility via the engine image tag suffix.

#### Scenario: Pinned pair is stated in the runbook

- **WHEN** the FerretDB+DocumentDB runbook document is read
- **THEN** it states both the gateway image tag (`ghcr.io/ferretdb/ferretdb:2.7.0`) and the engine image tag (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) as the current pinned pair

#### Scenario: Compatibility verification method is explained

- **WHEN** an operator reads the version-pinning section of the runbook
- **THEN** the runbook explains that the engine image tag suffix (`ferretdb-2.7.0`) encodes the compatible gateway version and how to use that suffix to verify a matched pair before upgrading

### Requirement: Verified tenancy model is documented without false isolation guarantees

The system SHALL document the verified tenancy model: a Mongo "database" is a logical namespace in one shared backing Postgres DB (shared `documentdb_data` schema); app-layer `tenantId` scoping (`applyTenantScopeToFilter` / `injectTenantIntoDocument` in `mongodb-data-api.mjs`) is the authoritative isolation boundary; PostgreSQL RLS coexists as a hardening layer; a per-tenant DocumentDB role does NOT constitute isolation (a `tenant_a` role can read `tenant_b` data); hard DB-level isolation requires a dedicated DocumentDB instance per tenant tier.

#### Scenario: Runbook states app-layer scoping as the authoritative isolation boundary

- **WHEN** the tenancy section of the FerretDB+DocumentDB runbook is read
- **THEN** it states that app-layer `tenantId` scoping is the authoritative isolation boundary, identifies `applyTenantScopeToFilter` and `injectTenantIntoDocument` as the enforcement points, and does NOT claim that the per-tenant DocumentDB role alone provides isolation

#### Scenario: Runbook states that hard isolation requires a dedicated DocumentDB instance

- **WHEN** the tenancy section of the FerretDB+DocumentDB runbook is read
- **THEN** it states that the backing Postgres DB is shared across tenants (logical namespace only), and that hard DB-level isolation requires a dedicated DocumentDB instance per tenant tier

#### Scenario: Runbook documents RLS as a hardening layer, not the primary boundary

- **WHEN** the tenancy section of the FerretDB+DocumentDB runbook is read
- **THEN** it states that PostgreSQL RLS coexists as an additional hardening layer but is not the primary isolation mechanism

### Requirement: Deployment topology and bundled extensions are documented

The system SHALL document that the DocumentDB engine runs in a dedicated Postgres instance (colocated topology was evaluated and rejected due to image and `shared_preload_libraries` coupling), that engine-first startup order is required, and that the engine bundles pgvector 0.8.1, PostGIS 3.6.0, rum 1.3, and pg_cron 1.6.

#### Scenario: Runbook states the dedicated-Postgres topology decision

- **WHEN** the topology section of the FerretDB+DocumentDB runbook is read
- **THEN** it states that the DocumentDB engine uses a dedicated Postgres instance and records that the colocated topology was rejected due to image and `shared_preload_libraries` coupling

#### Scenario: Runbook states engine-first startup requirement

- **WHEN** the topology section of the FerretDB+DocumentDB runbook is read
- **THEN** it states that the DocumentDB engine MUST be fully started before the FerretDB gateway is started

#### Scenario: Runbook lists bundled extensions with versions

- **WHEN** the topology section of the FerretDB+DocumentDB runbook is read
- **THEN** it lists the bundled extensions as pgvector 0.8.1, PostGIS 3.6.0, rum 1.3, and pg_cron 1.6

### Requirement: Compatibility-differences and remediations table is included

The system SHALL include a table in the runbook enumerating known MongoDB compatibility gaps in FerretDB v2, each with its remediation status and the owning change or mitigation strategy, covering at minimum: no change-stream support, no multi-document transactions, and the aggregation pipeline policy (adapter-allowed stages supported; `$out`/`$merge` blocked by the adapter allowlist).

#### Scenario: Compatibility table covers change streams with remediation direction

- **WHEN** the compatibility-differences table in the runbook is read
- **THEN** it contains an entry for change streams, states that FerretDB v2 does not support them, cross-references `add-ferretdb-realtime-cdc-remediation` as the owning remediation change, and names Postgres logical replication (pgoutput) as the remediation direction

#### Scenario: Compatibility table covers multi-document transactions

- **WHEN** the compatibility-differences table in the runbook is read
- **THEN** it contains an entry for multi-document transactions, states that they are not supported in FerretDB v2, and names idempotent single-document write design as the recommended mitigation

#### Scenario: Compatibility table covers aggregation pipeline policy

- **WHEN** the compatibility-differences table in the runbook is read
- **THEN** it contains an entry for aggregation pipeline stages, states that all 15 adapter-allowed stages are supported, and states that `$out` and `$merge` are blocked by the Falcone adapter allowlist (policy, not engine limitation)

### Requirement: FerretDB+DocumentDB licensing rationale is recorded

The system SHALL include a licensing section within the FerretDB+DocumentDB runbook that records why FerretDB (Apache-2.0) and the DocumentDB extension (MIT) were selected over MongoDB (SSPL), cross-linking ADR-14.

#### Scenario: Licensing section is present

- **WHEN** the FerretDB+DocumentDB runbook document is read
- **THEN** it contains a licensing section that states FerretDB is Apache-2.0 and the DocumentDB extension is MIT, and links to ADR-14

#### Scenario: Licensing section names MongoDB SSPL as the eliminated alternative

- **WHEN** the licensing section is read
- **THEN** it names MongoDB SSPL as the licensing constraint that was eliminated by adopting FerretDB+DocumentDB

### Requirement: MongoDB references are retired from all repository documentation

The system SHALL not reference MongoDB as the active document store in any repository documentation file (README, architecture diagrams, prose docs, or runbooks); all such references SHALL be replaced with FerretDB+DocumentDB equivalents or removed.

#### Scenario: README no longer names MongoDB as the document store

- **WHEN** `README.md` is read
- **THEN** MongoDB is not presented as Falcone's active document store; FerretDB+DocumentDB is named instead in any section describing the document-store backend

#### Scenario: No documentation file names MongoDB as the current document store

- **WHEN** all files under `docs/`, `docs-site/`, and `README*` are searched for the string "mongodb" or "MongoDB"
- **THEN** any remaining occurrences are either historical references within ADR-14 (the decision record) or migration-context prose, and none present MongoDB as the current operational store
