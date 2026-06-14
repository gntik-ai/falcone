## ADDED Requirements

### Requirement: SeaweedFS architecture and operations runbook exists

The system SHALL maintain an authoritative SeaweedFS architecture and operations runbook document in the repository documentation (under `docs-site/architecture/` or `docs/reference/architecture/`) that describes: the component topology (master, volume, filer, S3-API gateway nodes); the filer-on-PostgreSQL metadata store configuration; the per-tenant credential and identity model; the chosen replication factor; PVC sizing guidelines per component; the TLS and ingress surface and internal-only networking rules; and day-2 operations including scaling volume servers, backup procedures, health checks, and cross-references to the cutover and rollback runbooks.

#### Scenario: Runbook document is present and covers required sections

- **WHEN** a reviewer examines the repository documentation tree
- **THEN** a SeaweedFS runbook document exists at a canonical path under `docs-site/architecture/` or `docs/reference/architecture/` and contains sections covering topology, filer-on-PostgreSQL, per-tenant identity model, replication, PVC sizing, TLS/networking, and day-2 operations

#### Scenario: Runbook cross-references ADR-13

- **WHEN** the SeaweedFS runbook document is read
- **THEN** it contains a reference to ADR-13 (the SeaweedFS adoption decision record) by name or link

#### Scenario: Runbook cross-references cutover and rollback runbooks

- **WHEN** the SeaweedFS runbook document is read
- **THEN** it contains relative-path references to the cutover runbook (owned by `add-seaweedfs-data-migration-runbook`) and the rollback runbook (owned by `add-seaweedfs-rollback-plan`)

### Requirement: SeaweedFS licensing rationale is recorded

The system SHALL include a licensing note (as a section within the SeaweedFS runbook or as a dedicated note) that records why SeaweedFS (Apache-2.0) was selected over AGPL-licensed object-store alternatives, cross-linking ADR-13.

#### Scenario: Licensing note is present

- **WHEN** the SeaweedFS runbook document is read
- **THEN** it contains a licensing section or note that states the Apache-2.0 license rationale and links to ADR-13

#### Scenario: Licensing note names the AGPL alternative considered

- **WHEN** the licensing note is read
- **THEN** it names at least one AGPL-licensed object-store alternative that was considered and not chosen

### Requirement: SeaweedFS observability integration is documented

The system SHALL document, within the SeaweedFS runbook, how SeaweedFS component metrics and logs integrate with Falcone's existing observability stack, including the Prometheus scrape targets or ServiceMonitor configuration, the log label conventions, and references to any dashboards or alert rules.

#### Scenario: Observability section covers metrics and logs

- **WHEN** the SeaweedFS runbook document is read
- **THEN** it contains an observability section that references the Prometheus scrape endpoint or ServiceMonitor name for each SeaweedFS component and describes the log label scheme used in Falcone's log aggregation pipeline

#### Scenario: Observability section references alert rules

- **WHEN** the SeaweedFS runbook document is read
- **THEN** the observability section references or links to the alert rules (or their absence, with a TODO) for SeaweedFS component health

### Requirement: MinIO references are retired from all repository documentation

The system SHALL not reference MinIO as the active object store in any repository documentation file (README, architecture diagrams, prose docs, or runbooks); all such references SHALL be replaced with SeaweedFS equivalents or removed.

#### Scenario: README no longer names MinIO as the object store

- **WHEN** `README.md` is read
- **THEN** MinIO is not presented as Falcone's active object store; SeaweedFS is named instead in any section describing the storage backend

#### Scenario: Architecture diagram no longer shows MinIO

- **WHEN** the architecture diagram source is read
- **THEN** the diagram does not contain a MinIO node or label as the active storage backend

#### Scenario: No documentation file names MinIO as the current object store

- **WHEN** all files under `docs/`, `docs-site/`, and `README*` are searched for the string "minio" or "MinIO"
- **THEN** any remaining occurrences are either historical references within ADR-13 (the decision record) or legacy comparison notes, and none present MinIO as the current operational store
