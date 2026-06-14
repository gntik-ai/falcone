## ADDED Requirements

### Requirement: S3-to-S3 migration script copies all bucket objects idempotently

The system SHALL provide a migration script that copies all objects from every
MinIO bucket to the corresponding SeaweedFS bucket using `rclone sync` (or
`mc mirror` as a fallback), configurable per bucket, such that the script is
idempotent and safe to re-run for both the initial bulk pass (MinIO live,
writes flowing) and the final delta pass (write-freeze in effect), producing
no duplicate objects and leaving omitted buckets untouched.

#### Scenario: Initial sync copies all objects from all configured buckets

- **WHEN** the migration script is invoked in initial-sync mode against a MinIO
  instance with one or more populated buckets
- **THEN** every object in each configured bucket is present on SeaweedFS with
  the same key, content, and ETag after the script exits successfully

#### Scenario: Re-run is idempotent

- **WHEN** the migration script is invoked a second time on the same source and
  destination without any intervening object changes
- **THEN** the script exits successfully without re-uploading already-synced
  objects and without altering ETags or object counts on SeaweedFS

#### Scenario: Final delta pass converges after write-freeze

- **WHEN** the migration script is invoked in final-delta mode after a
  write-freeze has been applied to MinIO
- **THEN** only objects created or modified since the initial sync are copied,
  the object count on SeaweedFS equals the object count on MinIO for each
  bucket, and the script exits with a zero exit code

#### Scenario: Per-bucket scope limits blast radius

- **WHEN** the migration script is configured to migrate a specific subset of
  buckets
- **THEN** only those buckets are touched on SeaweedFS; buckets not in the
  configured list are neither created nor modified

### Requirement: Migration script captures integrity inputs before and after sync

The system SHALL capture object counts and checksums (ETag or MD5) for every
migrated bucket immediately before the initial sync begins and immediately after
the final delta sync completes, writing the results to a machine-readable
snapshot file, so that the downstream migration-validation change can compare
pre- and post-migration states deterministically.

#### Scenario: Pre-sync snapshot is written before any object transfer

- **WHEN** the migration script starts
- **THEN** a pre-sync snapshot file is written containing, for each configured
  bucket, the object count and a sorted list of `{key, etag, size}` tuples
  sourced from MinIO before any transfer begins

#### Scenario: Post-sync snapshot is written after final delta completes

- **WHEN** the final delta pass completes successfully
- **THEN** a post-sync snapshot file is written containing, for each migrated
  bucket, the object count and the same `{key, etag, size}` tuples sourced
  from SeaweedFS, enabling a diff comparison

#### Scenario: Snapshot diff detects divergence

- **WHEN** the post-sync snapshot is compared against the pre-sync snapshot
- **THEN** any bucket where object count or any ETag differs is reported as a
  divergence and the overall comparison exits non-zero

### Requirement: Pre-cutover compatibility gate must pass before runbook proceeds

The system SHALL provide a scripted pre-cutover compatibility check that tests
SeaweedFS against the S3 behaviors required by Falcone — addressing style,
presigned URL generation and resolution, multipart upload completion, and
IAM/policy semantics — re-using the adr-spike compatibility matrix, and the
cutover runbook SHALL be gated on all checks passing (go/no-go); if any check
fails the runbook MUST halt and report the failing assertion.

#### Scenario: Compatibility gate passes when SeaweedFS satisfies all checks

- **WHEN** the compatibility check script is run against a live SeaweedFS
  endpoint before cutover
- **THEN** all assertions (addressing style, presigned URL round-trip,
  multipart upload, IAM policy evaluation) pass and the script exits zero,
  allowing the runbook to proceed

#### Scenario: Compatibility gate halts runbook on failure

- **WHEN** at least one compatibility assertion fails against SeaweedFS
- **THEN** the script exits non-zero, prints the failing assertion name and
  observed vs. expected value, and the cutover runbook MUST NOT proceed to the
  write-freeze step

### Requirement: Cutover runbook is a gated ordered checklist with write-freeze default and zero-downtime trade-off note

The system SHALL provide a committed, operator-executable cutover runbook
consisting of the following ordered steps with explicit gates between them:
(1) run pre-cutover compatibility checks (go/no-go gate);
(2) apply write-freeze / start maintenance window (default path) or enable
dual-write bridge (zero-downtime alternative — operator must explicitly choose);
(3) run final delta sync;
(4) re-point Falcone to SeaweedFS by updating the chart storage config inline
fields (`provider`, `providerType`, `providerSelectionMode`) and performing a
Helm upgrade;
(5) validate object counts and ETags from the post-sync snapshot match the
pre-cutover snapshot;
(6) switch external traffic to the new endpoint.
Each step SHALL declare its own pass/fail criterion and rollback instruction.

#### Scenario: Runbook completes successfully under maintenance-window mode

- **WHEN** an operator executes the cutover runbook in maintenance-window mode
  with SeaweedFS reachable, the compatibility gate passing, and the final delta
  sync producing a matching post-sync snapshot
- **THEN** each step exits its gate with a pass result, Falcone is re-pointed
  to SeaweedFS, traffic is switched, and the runbook records a completion
  timestamp

#### Scenario: Runbook step failure triggers rollback instruction

- **WHEN** any runbook step exits with a non-zero status or its gate criterion
  is not met
- **THEN** the runbook halts at that step, prints the step's rollback
  instruction, and does not advance to subsequent steps

#### Scenario: Zero-downtime trade-off note is surfaced before write-freeze decision

- **WHEN** the operator reaches the write-freeze decision point in the runbook
- **THEN** the runbook displays both the maintenance-window path (default,
  simpler) and the dual-write/read-through bridge alternative (zero-downtime,
  higher operational complexity) and requires an explicit operator selection
  before continuing

### Requirement: Runbook is exercised end-to-end against a non-prod environment with results recorded

The system SHALL require that the cutover runbook is executed in full against a
non-production copy of the MinIO data before production use, and that the
results — including pre/post snapshots, compatibility gate output, and per-step
outcomes — are recorded in a runbook-results artifact committed alongside the
runbook.

#### Scenario: Non-prod dry-run produces a recorded results artifact

- **WHEN** the cutover runbook completes (successfully or with documented
  failures) against a non-prod environment
- **THEN** a runbook-results file is produced capturing the environment
  identifier, execution timestamp, pre-sync snapshot digest, post-sync snapshot
  digest, compatibility gate pass/fail per assertion, and the outcome of each
  runbook step
