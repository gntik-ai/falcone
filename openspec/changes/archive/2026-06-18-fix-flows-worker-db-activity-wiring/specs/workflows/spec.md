# workflows — spec delta for fix-flows-worker-db-activity-wiring

## ADDED Requirements

### Requirement: Workflow db.query activity not wired ('postgres executor not wired')

The system SHALL ensure that workflow db.query activity not wired ('postgres executor not wired') is corrected: Inject/configure the postgres (and mongo/storage/event) executor into the workflow-worker activities (DSN + tenant RLS context) via the chart `workflowWorker.config`.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A `db.query` flow inserts/reads a tenant-scoped row and the execution completes successfully
