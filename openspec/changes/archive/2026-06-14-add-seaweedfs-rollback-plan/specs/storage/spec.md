## ADDED Requirements

### Requirement: MinIO read-only retention window post-cutover
After cutover to SeaweedFS, the system SHALL retain the MinIO StatefulSet in a
read-only state and SHALL NOT reclaim its PVC until the rollback window (N days,
default 7) has elapsed and the non-prod rollback test gate has passed.

#### Scenario: MinIO StatefulSet is present and PVC is bound after cutover
- **WHEN** the SeaweedFS cutover has been completed (Falcone re-pointed to SeaweedFS)
- **THEN** the MinIO StatefulSet SHALL still exist in the cluster
- **THEN** the MinIO PVC SHALL be in Bound state
- **THEN** no new write requests SHALL be routed to MinIO

#### Scenario: MinIO PVC is not deleted before window closes
- **WHEN** the rollback window has NOT yet elapsed
- **THEN** any operator attempt to delete the MinIO PVC SHALL be blocked by the runbook
  gate (documented warning: point-of-no-return not yet reached)

### Requirement: Documented rollback procedure with trigger conditions
The system SHALL provide an ordered rollback procedure checklist that includes:
trigger conditions, steps to freeze writes and re-point Falcone's storage backend
config back to MinIO, a per-tenant smoke validation step, a resume step, and the
point-of-no-return marker.

#### Scenario: Rollback triggered by SeaweedFS failure within window
- **WHEN** a SeaweedFS operational failure occurs within the rollback window
- **THEN** the operator SHALL execute the rollback procedure in order:
  (1) freeze writes, (2) re-point Falcone config to MinIO endpoint via chart toggle,
  (3) run per-tenant storage smoke test, (4) confirm green, (5) resume traffic
- **THEN** the per-tenant smoke test SHALL pass before traffic is resumed

#### Scenario: Rollback procedure includes delta-back sync note
- **WHEN** rollback is triggered and writes have landed on SeaweedFS during the window
- **THEN** the runbook SHALL note that those writes are not automatically synced back
  to MinIO and SHALL document the delta-back sync option for operators who require
  those objects

### Requirement: Non-prod rollback validation gate before decommission
Before the MinIO StatefulSet and PVC are deleted, the system SHALL require that the
rollback procedure has been successfully executed and validated against a non-prod
environment (re-point to MinIO, per-tenant smoke green).

#### Scenario: Decommission blocked until non-prod test is green
- **WHEN** the rollback window has elapsed
- **THEN** the operator SHALL execute the rollback procedure on a non-prod copy of the
  environment
- **THEN** the per-tenant storage smoke test SHALL pass on the non-prod copy before the
  decommission step is unblocked

#### Scenario: Decommission proceeds after gate passes
- **WHEN** the non-prod rollback test is green
- **THEN** the operator SHALL delete the MinIO StatefulSet and PVC
- **THEN** the side-by-side chart toggle SHALL be disabled
- **THEN** the decommission date and outcome SHALL be recorded in the runbook

### Requirement: Point-of-no-return defined and communicated
The system SHALL define and record in the rollback runbook the point-of-no-return: the
moment the MinIO PVC is reclaimed. After this point, rollback to MinIO is not possible
without a restore from backup.

#### Scenario: Operator informed of point-of-no-return before PVC deletion
- **WHEN** an operator initiates the PVC deletion step
- **THEN** the runbook SHALL display a warning that deleting the PVC makes rollback
  impossible without a backup restore
- **THEN** the operator SHALL confirm the non-prod gate result before proceeding

#### Scenario: Rollback attempted after point-of-no-return
- **WHEN** the MinIO PVC has been deleted
- **THEN** rollback to MinIO SHALL NOT be possible via the standard procedure
- **THEN** the runbook SHALL direct the operator to the backup-restore capability for
  recovery

### Requirement: Window length and decommission outcome recorded
The system SHALL record the chosen rollback window length (N days) and the
decommission outcome (date, executor, smoke result) in the runbook at the time of
execution.

#### Scenario: Window length confirmed before cutover
- **WHEN** the cutover runbook step is initiated
- **THEN** the operator SHALL confirm the rollback window length (default 7 days) and
  record it in the runbook before proceeding with the cutover
