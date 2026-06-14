## ADDED Requirements

### Requirement: FerretDB migration decision is recorded as ADR-14

The system SHALL have ADR-14 appended to `docs-site/architecture/adrs.md` in the
established format (`## ADR-14 — title`, Decision / Why / Evidence / Risks sections)
documenting the selection of FerretDB 2.7.0 + DocumentDB 0.107 (Apache-2.0, LF
governance) as the replacement document store, and the rejection of Percona Server
(SSPL), native-JSONB (not MongoDB-wire-compatible), ArangoDB (BSL licence), RavenDB
(AGPL), and Couchbase (source-available), so that the document-store migration rationale
is permanently recorded and auditable.

#### Scenario: ADR-14 exists in the established format with all rejected alternatives

- **WHEN** a reviewer reads `docs-site/architecture/adrs.md`
- **THEN** an entry `## ADR-14` is present with non-empty Decision, Why, Evidence, and
  Risks sub-sections, and all five rejected alternatives (Percona Server, native-JSONB,
  ArangoDB, RavenDB, Couchbase) are each listed with an explicit rejection rationale

### Requirement: Compatibility matrix is produced and pinned to the version pair

The system SHALL produce a per-feature compatibility matrix pinned to
`ghcr.io/ferretdb/ferretdb:2.7.0` / `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`,
classifying each of the following as SUPPORTED, PARTIAL, or UNSUPPORTED with evidence
from the running instance: every aggregation stage allowed or blocked by
`services/adapters/src/mongodb-data-api.mjs` (`$match`, `$project`, `$sort`, `$limit`,
`$skip`, `$group`, `$unwind`, `$lookup` <=1, `$count`, `$facet` <=4, `$addFields`,
`$set`, `$unset`, `$replaceRoot`, `$replaceWith`, `$out`, `$merge`, `$geoNear`); every
index type (single-field, compound, unique, sparse, TTL); multi-document transactions
(`startTransaction`, `commitTransaction`, `abortTransaction`); and change streams
(`collection.watch()`, `changeStreamPreAndPostImages`) — so that downstream implementation
changes have a concrete, version-pinned compatibility baseline grounded in the real
FerretDB/DocumentDB instance.

#### Scenario: Matrix covers all required features with a version pin

- **WHEN** the spike findings are reviewed
- **THEN** the matrix lists every aggregation stage, index type, transaction operation,
  and change-stream operation enumerated in the requirement, each entry carries a
  SUPPORTED / PARTIAL / UNSUPPORTED classification with evidence from the running
  FerretDB 2.7 / DocumentDB 0.107 instance, and the version pair under test is stated
  explicitly

#### Scenario: Allowed aggregation stages are verified against the live instance

- **WHEN** each stage allowed by `services/adapters/src/mongodb-data-api.mjs` is executed
  against FerretDB 2.7 / DocumentDB 0.107
- **THEN** every stage receives a SUPPORTED / PARTIAL / UNSUPPORTED classification, and
  any PARTIAL entry records the exact deviation from MongoDB 6.0+ semantics observed in
  the response

#### Scenario: Blocked aggregation stages return an error on FerretDB

- **WHEN** `$out`, `$merge`, or `$geoNear` is submitted to FerretDB 2.7
- **THEN** the matrix records the stage as UNSUPPORTED and captures the wire error code
  returned by FerretDB

### Requirement: Change-stream gap is explicitly classified and resolved to a remediation path

The system SHALL classify change streams (`collection.watch()` with `$match` on
`fullDocument.tenantId` as used in `apps/control-plane/src/runtime/realtime-executor.mjs`,
and `ChangeStreamWatcher.mjs`) as SUPPORTED, PARTIAL, or UNSUPPORTED against FerretDB
2.7.0 / DocumentDB 0.107.0, and SHALL resolve the gap to a concrete remediation path
(re-architect with Postgres logical replication / shim / drop) with a downstream owner
assigned for each affected subsystem — so that the realtime-executor and CDC bridge
children cannot proceed without a clear migration path.

#### Scenario: Change-stream classification is recorded with wire evidence

- **WHEN** `collection.watch()` with the `$match` pipeline `{fullDocument.tenantId: <id>}`
  is called against FerretDB 2.7
- **THEN** the matrix records the outcome (SUPPORTED / PARTIAL / UNSUPPORTED) with the
  wire response or error code observed

#### Scenario: Pre-image enablement is classified

- **WHEN** `db.command({collMod, changeStreamPreAndPostImages:{enabled:true}})` is called
  against FerretDB 2.7 as used by `realtime-executor.mjs`
- **THEN** the matrix records the outcome (SUPPORTED / PARTIAL / UNSUPPORTED) with the
  wire response observed

#### Scenario: Each change-stream gap has a remediation path and owner

- **WHEN** the spike findings are reviewed
- **THEN** the change-stream gap for `realtime-executor.mjs` and the change-stream gap
  for `ChangeStreamWatcher.mjs` each have an assigned remediation path (re-architect /
  shim / drop) and an identified downstream owner; no gap is left unresolved

### Requirement: Multi-document-transaction gap is explicitly classified and resolved

The system SHALL classify multi-document transactions (`startTransaction`,
`commitTransaction`, `abortTransaction` as declared in `services/adapters/src/mongodb-data-api.mjs`)
as SUPPORTED, PARTIAL, or UNSUPPORTED against FerretDB 2.7.0 / DocumentDB 0.107.0, and
SHALL resolve the gap to a remediation path (shim to single-operation semantics / drop)
with a one-sentence rationale — so that the data-api migration child has an unambiguous
implementation directive.

#### Scenario: Transaction commands are classified with wire evidence

- **WHEN** `startTransaction`, `commitTransaction`, and `abortTransaction` are each
  submitted via the MongoDB wire protocol to FerretDB 2.7
- **THEN** the matrix records each command as SUPPORTED / PARTIAL / UNSUPPORTED with
  the wire response or error code observed

#### Scenario: Transaction gap has a remediation path

- **WHEN** `commitTransaction` or `abortTransaction` is classified as PARTIAL or
  UNSUPPORTED
- **THEN** the spike finding assigns a remediation path (shim to single-op / drop) with
  a one-sentence rationale, and no PARTIAL or UNSUPPORTED transaction entry is left
  without a recommendation

### Requirement: Every non-SUPPORTED matrix entry has a use/shim/drop/re-architect recommendation

The system SHALL resolve every PARTIAL or UNSUPPORTED entry in the FerretDB compatibility
matrix to one of: use (FerretDB native equivalent works with a configuration change),
shim (thin adaptation layer in `services/adapters/src/mongodb-data-api.mjs` or the
executor), drop (feature removed from Falcone's data-api capability), or re-architect
(structural change required — reserved for change streams) — so that the deployment,
per-tenant-provisioning, realtime-executor, and CDC-bridge downstream changes have
unambiguous guidance.

#### Scenario: Every non-SUPPORTED entry has a recommendation

- **WHEN** the spike findings are reviewed
- **THEN** no PARTIAL or UNSUPPORTED entry in the matrix is left without a
  use / shim / drop / re-architect recommendation and a brief rationale

### Requirement: Per-tenant DocumentDB database/role/auth mapping is resolved

The system SHALL resolve, via a spike against the running FerretDB 2.7 / DocumentDB
0.107 instance, how a FerretDB "database" maps to an isolated per-tenant backend given
the decision to use real per-tenant DocumentDB databases and Postgres roles — pinning
the database naming convention, role creation and grant pattern, and authentication
credential injection — so that the per-tenant provisioning downstream child has a
concrete, tested mapping to implement.

#### Scenario: Per-tenant database isolation is confirmed

- **WHEN** two test tenants each have a dedicated DocumentDB database on the same engine
  instance
- **THEN** a cross-database query attempted from tenant A's role is rejected, confirming
  database-level isolation

#### Scenario: FerretDB gateway authenticates with a per-tenant Postgres role

- **WHEN** a per-tenant Postgres role with the minimum required privileges is created
  on the DocumentDB engine
- **THEN** the FerretDB gateway authenticates using that role's credentials and the
  spike finding records the exact grant statements required

#### Scenario: Tenancy mapping is compatible with the existing postgres-applier model

- **WHEN** the per-tenant database/role creation pattern is reviewed against
  `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`
- **THEN** the spike finding records whether the existing applier model can be extended
  to cover DocumentDB provisioning, or identifies the DDL gaps that require a new applier

### Requirement: Colocated-vs-dedicated Postgres decision is recorded

The system SHALL record in ADR-14 whether DocumentDB will run on Falcone's existing
in-chart Postgres instance (colocated) or a dedicated Postgres instance, factoring
`shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` compatibility with
existing extensions and resource isolation requirements, so that the deployment child
has an authoritative infrastructure decision to implement.

#### Scenario: shared_preload_libraries compatibility is verified

- **WHEN** the DocumentDB extension `pg_documentdb_core,pg_documentdb` is loaded
  alongside `pg_cron` on the same Postgres 17 instance used by the spike
- **THEN** the spike finding records whether the combination succeeds without conflict,
  and the colocated-vs-dedicated decision is recorded with a rationale in ADR-14

#### Scenario: Colocated DocumentDB coexists with schema-per-tenant relational schemas

- **WHEN** DocumentDB extensions are enabled on a Postgres instance that also hosts
  Falcone's schema-per-tenant relational schemas and the `falcone_app` non-BYPASSRLS role
- **THEN** the spike finding records whether coexistence is clean (no DDL conflicts, no
  RLS bypass, no extension interference), or documents the exact conflict and recommends
  dedicated Postgres

### Requirement: Version pair and upgrade order are documented

The system SHALL document the pinned version pair
(`ghcr.io/ferretdb/ferretdb:2.7.0` / `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
and the required upgrade order (DocumentDB engine first, then FerretDB gateway) in
ADR-14's Evidence section, so that all downstream children have an unambiguous version
anchor and operators have a safe upgrade sequence.

#### Scenario: ADR-14 Evidence section contains the pinned version pair and upgrade order

- **WHEN** a reviewer reads the Evidence section of ADR-14 in `docs-site/architecture/adrs.md`
- **THEN** the exact image tags for both `ferretdb` and `postgres-documentdb` are stated,
  and the upgrade order (engine first, gateway second) is explicitly documented with a
  one-sentence rationale
