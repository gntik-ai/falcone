## ADDED Requirements

### Requirement: MongoDB read-only retention window post-cutover

After cutover to FerretDB+DocumentDB, the system SHALL retain the MongoDB StatefulSet
in a read-only state and SHALL NOT reclaim its PVC until the rollback window (N days,
default 7) has elapsed and the non-prod rollback test gate has passed.

#### Scenario: MongoDB StatefulSet is present and PVC is bound after cutover

- **WHEN** the FerretDB+DocumentDB cutover has been completed (`MONGO_URI` re-pointed
  to the FerretDB gateway in `apps/control-plane/src/runtime/main.mjs`)
- **THEN** the MongoDB StatefulSet SHALL still exist in the cluster
- **THEN** the MongoDB PVC SHALL be in Bound state
- **THEN** no new write requests SHALL be routed to MongoDB

#### Scenario: MongoDB PVC is not deleted before window closes

- **WHEN** the rollback window has NOT yet elapsed
- **THEN** any operator attempt to delete the MongoDB PVC SHALL be blocked by the
  runbook gate (documented warning: point-of-no-return not yet reached)

### Requirement: The system SHALL retain the FerretDB Postgres engine PVC as a separate item during the window

The system SHALL retain the Postgres engine PVC for the duration of the rollback window
alongside the MongoDB PVC. The FerretDB Postgres engine PVC is a distinct retention item
from the MongoDB PVC. If the FerretDB stack requires a restart during the window,
the system SHALL start the Postgres DocumentDB engine before starting the FerretDB gateway
(ENGINE-FIRST ordering).

#### Scenario: Both PVCs are present during the rollback window

- **WHEN** the rollback window is active
- **THEN** the MongoDB PVC SHALL be in Bound state (rollback anchor)
- **THEN** the FerretDB Postgres engine PVC SHALL be in Bound state (separate retention item)
- **THEN** the FerretDB gateway SHALL NOT be started before the Postgres DocumentDB engine
  is healthy (ENGINE-FIRST ordering)

### Requirement: Documented rollback procedure with trigger conditions

The system SHALL provide an ordered rollback procedure checklist that includes: trigger
conditions, steps to freeze writes, re-point `MONGO_URI` back to MongoDB (reversing the
`apps/control-plane/src/runtime/main.mjs::mongoUri` resolution), decommission the
Postgres pgoutput realtime/CDC pipeline (`add-ferretdb-realtime-cdc-remediation`
components), restore the MongoDB change-stream path
(`apps/control-plane/src/runtime/realtime-executor.mjs:66` and
`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42`), a per-tenant data-API
smoke validation step, confirmation that MongoDB change-stream delivery is functional
after rollback, a resume step, and the point-of-no-return marker.

#### Scenario: Rollback triggered by FerretDB failure within window

- **WHEN** a FerretDB+DocumentDB operational failure occurs within the rollback window
- **THEN** the operator SHALL execute the rollback procedure in order:
  (1) freeze writes,
  (2) re-point `MONGO_URI` to MongoDB endpoint,
  (3) decommission the Postgres pgoutput realtime/CDC pipeline
      (`add-ferretdb-realtime-cdc-remediation` components),
  (4) restore the MongoDB change-stream path (`realtime-executor.mjs:66`,
      `ChangeStreamWatcher.mjs:42`) and confirm `collection.watch()` is functional
      against MongoDB,
  (5) run per-tenant data-API smoke test,
  (6) confirm smoke green and MongoDB change-stream delivery verified,
  (7) resume traffic
- **THEN** the per-tenant data-API smoke test SHALL pass before traffic is resumed
- **THEN** MongoDB change-stream delivery SHALL be confirmed functional before traffic
  is resumed

#### Scenario: Rollback procedure includes best-effort delta-back sync note

- **WHEN** rollback is triggered and writes have landed on the FerretDB Postgres engine
  during the window
- **THEN** the runbook SHALL note that those writes cannot be synced back via change
  streams or oplog tailing (both unsupported on FerretDB; `CommandNotSupported(115)`)
- **THEN** the runbook SHALL document the delta-back sync option as a best-effort
  idempotent single-document UPSERT export keyed on `_id` from the DocumentDB Postgres
  engine into MongoDB
- **THEN** the operator SHALL explicitly acknowledge the best-effort nature of the
  delta-back sync before rollback is marked complete

### Requirement: The rollback procedure SHALL transition realtime and CDC from the pgoutput pipeline back to MongoDB change streams

The rollback procedure SHALL decommission the Postgres pgoutput logical-replication
pipeline (`add-ferretdb-realtime-cdc-remediation`) and SHALL restore the MongoDB
change-stream path. During the FerretDB window, realtime and CDC are served exclusively
by that pgoutput pipeline. The system SHALL NOT attempt to verify change-stream delivery
against FerretDB at any point — change streams are unsupported on FerretDB
(`CommandNotSupported(115)` at `realtime-executor.mjs:66` and
`ChangeStreamWatcher.mjs:42`); the verification gate applies only to MongoDB after rollback.

#### Scenario: pgoutput pipeline decommissioned before MongoDB change-stream path is restored

- **WHEN** the `MONGO_URI` has been re-pointed to MongoDB as part of rollback
- **THEN** the operator SHALL decommission the Postgres pgoutput realtime/CDC pipeline
  components introduced by `add-ferretdb-realtime-cdc-remediation`
- **THEN** the operator SHALL restore the MongoDB change-stream path
  (`realtime-executor.mjs:66` and `ChangeStreamWatcher.mjs:42`)
- **THEN** `collection.watch()` SHALL be confirmed functional against MongoDB before
  writes are resumed
- **THEN** no verification of change-stream delivery SHALL be attempted against FerretDB

#### Scenario: MongoDB change-stream delivery confirmed functional after rollback

- **WHEN** the MongoDB change-stream path has been restored
- **THEN** the system SHALL confirm that `collection.watch()` on MongoDB returns a valid
  change stream cursor without raising `CommandNotSupported`
- **THEN** the CDC bridge (`services/mongo-cdc-bridge/`) SHALL be confirmed as connected
  to MongoDB before writes are resumed

### Requirement: Non-prod rollback validation gate before decommission

Before the MongoDB StatefulSet and PVC are deleted, the system SHALL require that the
rollback procedure has been successfully executed and validated against a non-prod
environment: re-point `MONGO_URI` to MongoDB, decommission pgoutput pipeline, restore
MongoDB change-stream path, per-tenant data-API smoke green, MongoDB change-stream
delivery verified functional.

#### Scenario: Decommission blocked until non-prod test is green

- **WHEN** the rollback window has elapsed
- **THEN** the operator SHALL execute the rollback procedure on a non-prod copy of the
  environment
- **THEN** the per-tenant data-API smoke test SHALL pass on the non-prod copy
- **THEN** MongoDB change-stream delivery SHALL be verified functional on the non-prod
  copy before the decommission step is unblocked

#### Scenario: Decommission proceeds after gate passes

- **WHEN** the non-prod rollback test is green
- **THEN** the operator SHALL delete the MongoDB StatefulSet and PVC (if MongoDB is the
  definitive target) OR the FerretDB Postgres engine, gateway, and their PVC (if
  rollback is confirmed unnecessary and FerretDB is the definitive target)
- **THEN** the side-by-side chart toggle SHALL be updated in `charts/in-falcone/values.yaml`
- **THEN** the decommission date, executor, and final smoke result SHALL be recorded in
  the runbook

### Requirement: Point-of-no-return defined and communicated

The system SHALL define and record in the rollback runbook the point-of-no-return: the
moment the MongoDB PVC is reclaimed. After this point, rollback to MongoDB is not
possible without a restore from backup.

#### Scenario: Operator informed of point-of-no-return before PVC deletion

- **WHEN** an operator initiates the MongoDB PVC deletion step
- **THEN** the runbook SHALL display a warning that deleting the PVC makes rollback
  impossible without a backup restore
- **THEN** the operator SHALL confirm the non-prod gate result before proceeding

#### Scenario: Rollback attempted after point-of-no-return

- **WHEN** the MongoDB PVC has been deleted
- **THEN** rollback to MongoDB SHALL NOT be possible via the standard procedure
- **THEN** the runbook SHALL direct the operator to the backup-restore capability for
  recovery

### Requirement: Window length and decommission outcome recorded

The system SHALL record the chosen rollback window length (N days) and the decommission
outcome (date, executor, smoke result, delta-back sync acknowledgement) in the runbook
at the time of execution.

#### Scenario: Window length confirmed before cutover

- **WHEN** the cutover runbook step is initiated
- **THEN** the operator SHALL confirm the rollback window length (default 7 days) and
  record it in the runbook before proceeding with the cutover
