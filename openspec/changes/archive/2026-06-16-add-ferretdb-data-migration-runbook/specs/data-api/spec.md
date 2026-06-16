## ADDED Requirements

### Requirement: Dedicated engine topology and engine-first startup order are established before migration begins

The system SHALL require that the FerretDB migration runs against a dedicated
Postgres engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
that is not colocated with the existing Postgres instance, and SHALL enforce an
engine-first startup order in which the postgres-documentdb pod reaches Ready
before the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) starts, such
that the migration runbook asserts both preconditions before any data transfer
begins.

#### Scenario: Migration halts when engine pod is not Ready before gateway start

- **WHEN** the migration runbook executes its precondition check and the
  postgres-documentdb engine pod is not yet in Ready state
- **THEN** the runbook halts immediately, prints a message identifying the
  engine-not-ready condition, and does not start the FerretDB gateway or
  any data transfer

#### Scenario: Migration proceeds when dedicated engine is Ready and gateway is up

- **WHEN** the migration runbook executes its precondition check and the
  postgres-documentdb engine pod is Ready and the FerretDB gateway is reachable
- **THEN** the runbook advances to the bulk copy phase

### Requirement: Initial bulk copy performs idempotent single-document upserts keyed on _id

The system SHALL provide a migration script that performs a snapshot export
(`mongodump`) from the source MongoDB replica set (bitnami/mongodb:8.0.0,
`MONGO_URI` — `apps/control-plane/src/runtime/main.mjs::mongoUri`) and then
applies every exported document to FerretDB (`ghcr.io/ferretdb/ferretdb:2.7.0`)
as an idempotent single-document upsert keyed on `_id` (replaceOne with
`upsert:true`), preserving the tenant-to-collection mapping (documents carry the
`tenantId` field), such that the script is re-runnable and a partial failure
leaves FerretDB in a consistent sub-state that can be safely continued without
re-running from the beginning.

The script SHALL NOT use transactional batch apply: `commitTransaction` returns
CommandNotFound(59) on FerretDB and in-transaction writes persist without
atomicity; `abortTransaction` is a silent no-op.

The script SHALL NOT use `mongorestore --oplogReplay` for delta convergence:
oplog replay requires atomic multi-doc apply, which is unsupported on FerretDB,
and will not converge.

#### Scenario: Initial bulk copy transfers all documents for all configured databases

- **WHEN** the migration script is invoked in initial mode against a MongoDB
  replica set with one or more populated tenant collections
- **THEN** every document in each configured database and collection is present
  on FerretDB with the same `_id`, field values, and `tenantId` after the
  script exits successfully

#### Scenario: Partial failure on initial copy is safely retried without duplication

- **WHEN** the migration script fails partway through the initial bulk copy and
  is re-invoked in initial mode without manual cleanup
- **THEN** documents already upserted on FerretDB are updated in place (not
  duplicated), remaining documents are upserted, and the script exits zero once
  all documents are present

### Requirement: Delta convergence uses re-export and idempotent upsert inside the write-freeze window

The system SHALL provide a delta convergence step that runs inside the
maintenance-window write-freeze: the operator re-exports documents modified on
MongoDB since the initial copy timestamp (via `mongodump` with a timestamp-based
query filter, or a full re-export for collections without an update-time field)
and applies them to FerretDB as idempotent `_id` upserts, such that once the
write-freeze prevents new writes from arriving on MongoDB, the FerretDB target
converges exactly to the source state at freeze time.

The delta convergence step SHALL NOT use oplog replay (`mongodump --oplog` /
`mongorestore --oplogReplay`): oplog replay requires atomic multi-document apply
which is non-atomic on FerretDB and will not converge.

#### Scenario: Delta convergence applied during write-freeze produces exact source parity

- **WHEN** the delta re-export and idempotent upsert step completes inside the
  write-freeze window against a MongoDB source where no new writes can arrive
- **THEN** the per-collection document count on FerretDB equals the count on
  MongoDB, and the per-collection checksum on FerretDB equals the checksum on
  MongoDB, and the script exits zero

#### Scenario: Delta convergence is idempotent on re-run

- **WHEN** the delta upsert step is executed a second time against the same
  FerretDB target without any changes to the source
- **THEN** no duplicate documents are inserted, document counts are unchanged,
  and the script exits zero

### Requirement: Index migration recreates all index types from MongoDB on FerretDB without type-based halting

The system SHALL introspect all non-`_id` indexes on the source MongoDB instance,
export their definitions to a machine-readable JSON file, and recreate each index
on the FerretDB target after the restore completes.

The script SHALL NOT halt on text or 2dsphere index types: both are functional
on FerretDB 2.7.0 (the engine bundles rum and postgis extensions). The script
SHALL recreate single, compound, unique, sparse, and TTL indexes in addition to
text and 2dsphere indexes. The only constraint that applies at the stage level is
the adapter allowlist blocking `$out` and `$merge` aggregation stages, which is
not an index concern and does not affect index migration.

#### Scenario: All non-_id indexes including text and 2dsphere are created on FerretDB

- **WHEN** the index recreation script is run after a successful initial copy
  against a FerretDB instance containing the migrated collections
- **THEN** every non-`_id` index exported from MongoDB is present on FerretDB
  with the same name, key pattern, and options (including text and 2dsphere
  index types), and the script exits zero

#### Scenario: Index recreation log records pass or fail per index

- **WHEN** the index recreation script completes (successfully or with errors)
- **THEN** for each index it prints either `PASS: index <name> on
  <db>.<collection>` or `FAIL: index <name> on <db>.<collection>
  error=<message>`, and the script exits non-zero if any index failed

### Requirement: Integrity verification compares per-collection document counts, checksums, and index presence

The system SHALL capture per-collection integrity snapshots — document count,
sha256 checksum over `_id`-sorted documents, and index presence — from both
the MongoDB source and the FerretDB target, and SHALL provide a comparison
tool that exits non-zero and reports divergences when any collection's count,
checksum, or index presence differs between source and target.

#### Scenario: Pre-copy snapshot is written before any data transfer

- **WHEN** the migration script starts
- **THEN** a pre-copy snapshot file is written containing, for each configured
  collection, the document count, checksum, and index list sourced from MongoDB
  before any data transfer begins

#### Scenario: Post-delta snapshot is written after delta convergence completes

- **WHEN** the delta upsert step completes successfully inside the write-freeze
  window
- **THEN** a post-delta snapshot file is written containing, for each migrated
  collection, the document count, checksum, and index list sourced from FerretDB

#### Scenario: Snapshot comparison detects count or checksum divergence

- **WHEN** the post-delta snapshot is compared against the pre-copy snapshot
  and at least one collection has a differing document count or checksum
- **THEN** the comparison tool reports the diverging collection name, the
  expected and observed values, and exits non-zero

#### Scenario: Snapshot comparison confirms parity on matching state

- **WHEN** the post-delta snapshot is compared against the pre-copy snapshot
  and all collections have identical document counts, checksums, and index
  presence
- **THEN** the comparison tool prints a parity-confirmed summary and exits zero

### Requirement: Cutover runbook is a maintenance-window write-freeze procedure with no dual-write alternative

The system SHALL provide a committed, operator-executable cutover runbook using
maintenance-window write-freeze as the only valid cutover model. The zero-downtime
/ dual-write alternative SHALL NOT be present in the runbook: change streams are
unsupported on FerretDB (`watch()` returns CommandNotSupported(115)) and any
CDC-based sync path cannot run against FerretDB.

The runbook SHALL consist of the following ordered steps with explicit gates and
rollback instructions between them:
(1) Precondition check: dedicated engine Ready, gateway reachable, version pair
    confirmed (ferretdb:2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0).
(2) Write-freeze / maintenance-window start.
(3) Delta re-export from MongoDB of documents changed since the initial copy.
(4) Idempotent `_id` upsert of re-exported documents into FerretDB.
(5) Index recreation on FerretDB.
(6) Run snapshot comparison (counts, checksums, index presence); gate: parity
    confirmed.
(7) Re-point Falcone to FerretDB: update `MONGO_URI`
    (`apps/control-plane/src/runtime/main.mjs::mongoUri`) to the FerretDB
    gateway endpoint; confirm engine-first startup order is satisfied; perform
    Helm upgrade / pod restart.
(8) Exit maintenance window / switch traffic.

The runbook SHALL include a prominent notice that realtime/CDC features
(realtime-executor, mongo-cdc-bridge) are non-functional on FerretDB after
cutover and direct the operator to `add-ferretdb-realtime-cdc-remediation`
before enabling those features.

Each step SHALL declare its gate criterion and a rollback instruction; the
rollback section SHALL reference `add-ferretdb-rollback-plan` as the full
rollback procedure.

#### Scenario: Runbook completes successfully under maintenance-window mode

- **WHEN** an operator executes the cutover runbook in maintenance-window mode
  with the dedicated engine Ready, the FerretDB gateway reachable, the delta
  upsert producing a matching post-delta snapshot, and all indexes recreated
  successfully
- **THEN** each step exits its gate with a pass result, Falcone is re-pointed
  to FerretDB via `MONGO_URI` with the engine-first startup order satisfied,
  traffic is switched, and the runbook records a completion timestamp

#### Scenario: Runbook step failure triggers rollback instruction

- **WHEN** any runbook step exits with a non-zero status or its gate criterion
  is not met
- **THEN** the runbook halts at that step, prints the step-specific rollback
  instruction and a reference to `add-ferretdb-rollback-plan`, and does not
  advance to subsequent steps

#### Scenario: MONGO_URI revert restores MongoDB traffic without data loss

- **WHEN** the operator executes the rollback procedure after a failed cutover
- **THEN** `MONGO_URI` is reverted to the original MongoDB endpoint, Falcone
  resumes serving requests from MongoDB, and no tenant documents have been
  modified on the source MongoDB during the migration window

#### Scenario: Runbook warns that realtime and CDC are non-functional after cutover

- **WHEN** an operator reads the cutover runbook
- **THEN** a prominent notice is present stating that realtime/CDC features are
  non-functional on FerretDB (change streams unsupported) and directing the
  operator to `add-ferretdb-realtime-cdc-remediation` before enabling those
  features post-cutover

### Requirement: Cutover runbook is exercised end-to-end against a non-prod environment with results recorded

The system SHALL require that the cutover runbook is executed in full against a
non-production copy of the MongoDB data (tests/env mongo:7 or local Docker
Compose) before production use, and that the results — including pre/post
snapshots, index recreation log, and per-step outcomes — are recorded in a
runbook-results artifact committed alongside the runbook.

#### Scenario: Non-prod dry-run produces a committed results artifact

- **WHEN** the cutover runbook completes (successfully or with documented
  failures) against a non-prod environment
- **THEN** a runbook-results file is produced capturing the environment
  identifier, execution timestamp, sha256 digests of the pre/post snapshot
  files, index recreation pass/fail per collection, and the outcome of each
  runbook step, and this file is committed to the repository
